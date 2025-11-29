# Quick Tabs: Multiple Coordination and Lifecycle Issues

**Extension Version:** v1.6.4.6 | **Date:** 2025-11-29 | **Scope:** Restore flow creates duplicate windows and multiple coordination failures

---

## Executive Summary

The Quick Tab feature has multiple critical bugs affecting window restore, minimize operations, and state synchronization. The primary issue is a coordination failure between QuickTabWindow, UICoordinator, and MinimizedManager that causes duplicate visible windows when restoring minimized tabs. Additional issues include duplicate minimize requests, misleading position verification logging, storage count inconsistencies, event listener cleanup failures, and storage write storms. All issues stem from lack of centralized rendering authority and insufficient coordination between lifecycle management components.

## Issues Overview

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| #1: Duplicate window on restore | QuickTabWindow + UICoordinator | Critical | Both components render independently |
| #2: Duplicate minimize requests | VisibilityHandler | High | Multiple sources trigger same operation |
| #3: Misleading DOM position logs | MinimizedManager | Medium | Verification before RAF callback executes |
| #4: Storage count inconsistency | VisibilityHandler | Medium | Duplicate windows counted separately |
| #5: Event listeners persist after destroy | QuickTabWindow | Medium | Incomplete cleanup on destroy |
| #6: Storage write storm on Close All | DestroyHandler | Medium | Each tab destruction triggers write |

**Why bundled:** All issues affect Quick Tab lifecycle coordination; share state management architecture; require coordinated fixes to establish clear component responsibilities.

<scope>
**Modify:**
- `src/features/quick-tabs/window.js` (restore, render, destroy methods)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (update, render methods)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleMinimize, handleRestore)
- `src/features/quick-tabs/minimized-manager.js` (restore method)

**Do NOT Modify:**
- `src/background/` (out of scope)
- `sidebar/quick-tabs-manager.js` (Manager panel works correctly)
- Storage schema or data structures
</scope>

---

## Issue #1: Duplicate Window Appears on Restore

### Problem
When user restores a minimized Quick Tab from Manager panel, two identical windows appear at the same position, both fully visible and interactive.

### Root Cause
**Files:** 
- `src/features/quick-tabs/window.js`
- `src/features/quick-tabs/coordinators/UICoordinator.js`

**Location:** 
- `QuickTabWindow.restore()` (lines 579-594)
- `UICoordinator.update()` (lines 90-130)

**Issue:** Coordination failure between components results in two independent render calls within same millisecond. When minimize removes DOM, both QuickTabWindow instance sets `this.container = null` and UICoordinator clears its `renderedTabs` Map entry. During restore, QuickTabWindow's `restore()` method checks `if (!this.container)` which evaluates true, triggering first render. Immediately after, VisibilityHandler emits `state:updated` event, UICoordinator receives it and checks `if (!this.renderedTabs.has(quickTab.id))` which also evaluates true, triggering second render. Both renders complete within same millisecond, both requestAnimationFrame callbacks queue for next paint, and both windows move from offscreen (-9999px) to target position and become visible.

**Evidence from logs:**
- 22:02:31.457 - First render from QuickTabWindow.restore()
- 22:02:31.458 - Second render from UICoordinator.update()
- Both windows positioned at same coordinates (left: 761px, top: 223px)

### Fix Required
Establish single source of rendering authority. Either QuickTabWindow should never call render() internally and delegate all rendering to UICoordinator, OR UICoordinator should check actual DOM presence before rendering (not just Map entry). Recommended approach: have restore() only update instance properties without rendering, emit state change, and let UICoordinator handle render coordination. Add synchronization check to ensure UICoordinator Map is updated before restore completes.

---

## Issue #2: Duplicate Minimize Request

### Problem
Minimize operation is called twice in same millisecond, with second call being ignored as duplicate.

### Root Cause
**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` (lines 136-151)  
**Issue:** Multiple sources (Quick Tab window minimize button and Manager panel minimize button) trigger minimize operation simultaneously. VisibilityHandler's debounce mechanism catches duplicate but doesn't prevent initial double-trigger.

**Evidence from logs:**
- 22:02:29.809 - First minimize completes successfully
- 22:02:29.809 - "Ignoring duplicate minimize request" logged in same millisecond

### Fix Required
Add event coordination to prevent multiple sources from triggering same operation. Either implement mutex/lock pattern for minimize operations, or add early return check for tabs already in process of minimizing. Alternative: investigate why both Quick Tab button and Manager button fire simultaneously and fix at event source level.

---

## Issue #3: Misleading DOM Position Verification

### Problem
Post-restore position verification logs show window at offscreen position (-9999px, -9999px) when window is actually visible at correct position.

### Root Cause
**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** `restore()` verification (immediately after line 153)  
**Issue:** Position verification executes immediately after render() returns, but render() uses requestAnimationFrame to move window from offscreen to target position. Verification captures intermediate offscreen state before RAF callback executes.

**Evidence from logs:**
- 22:02:31.457 - "Verified DOM position after restore ... containerLeft -9999px, containerTop -9999px"
- Window is actually visible at correct position despite log indicating offscreen

### Fix Required
Move position verification inside requestAnimationFrame callback after position update completes, or remove misleading verification entirely. If verification is needed for debugging, add second verification log after RAF execution showing final position.

---

## Issue #4: Storage Count Inconsistency

### Problem
Minimized tab count jumps erratically (1 minimized → 2 minimized → 1 minimized) within 3-second window when only one tab was actually minimized/restored.

### Root Cause
**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** Storage persistence logic (lines tracking minimized count)  
**Issue:** Duplicate window created during restore is being counted as separate tab when storage persistence scans all QuickTabWindow instances. Count fluctuates as duplicate window is created then potentially cleaned up.

**Evidence from logs:**
- 22:02:29.961 - "Persisting 2 tabs (1 minimized)"
- 22:02:32.226 - "Persisting 2 tabs (2 minimized)"
- 22:02:31.621 - "Persisting 2 tabs (1 minimized)"
- User only performed one minimize/restore operation

### Fix Required
Fix depends on resolving Issue #1 (duplicate window). Once single rendering authority established, count inconsistency should resolve automatically. Add validation to ensure only one QuickTabWindow instance exists per tab ID before persistence.

---

## Issue #5: Event Listeners Fire After Window Destroyed

### Problem
Drag events continue firing after Quick Tab window is destroyed, suggesting event listeners not fully cleaned up.

### Root Cause
**File:** `src/features/quick-tabs/window.js`  
**Location:** `destroy()` method (cleanup section)  
**Issue:** Event listeners attached during window lifecycle are not fully detached when window is destroyed, allowing ghost events to fire for destroyed windows.

**Evidence from logs:**
- 22:02:41.321 - "QuickTabWindow Destroyed qt-121-1764453744449"
- 22:02:42.094 - "QuickTabWindow Drag started qt-121-1764453746267 363 599"
- Drag event fires 773ms after destroy

### Fix Required
Audit all event listener attachments in QuickTabWindow lifecycle. Ensure every addEventListener has corresponding removeEventListener in destroy() method. Pay special attention to drag controller and resize controller cleanup. Verify listeners are removed before DOM element removal, not after.

---

## Issue #6: Close All Triggers Storage Write Storm

### Problem
Closing all Quick Tabs triggers 6+ rapid storage writes in 24ms, potentially causing performance issues and race conditions.

### Root Cause
**File:** `src/features/quick-tabs/handlers/DestroyHandler.js`  
**Location:** Individual tab destruction logic  
**Issue:** Each tab destruction independently triggers storage persistence. When multiple tabs destroyed in rapid succession (Close All operation), each write happens immediately without coordination, creating write storm.

**Evidence from logs:**
- 22:02:55.793 through 22:02:55.817 - Six storage.onChanged events in 24ms
- Each represents separate write operation during Close All

### Fix Required
Implement batch persistence for Close All operations. Debounce or throttle storage writes during bulk operations, collecting all state changes and writing once at completion. Follow pattern where Close All operation marks all tabs for destruction, then performs single coordinated storage write after all DOM cleanup completes.

---

## Shared Implementation Notes

**Rendering Authority:**
- Establish UICoordinator as single source of truth for rendering decisions
- QuickTabWindow should manage internal state but delegate rendering coordination to UICoordinator
- All render() calls should either originate from UICoordinator or be approved/tracked by UICoordinator

**Map Synchronization:**
- UICoordinator.renderedTabs Map must stay synchronized with actual DOM state
- When minimize removes DOM, either keep Map entry with "dormant" flag or verify DOM presence before trusting Map
- Add logging when Map entries added/removed to aid debugging

**Event Coordination:**
- Implement mutex pattern for state-changing operations (minimize, restore, destroy)
- Prevent multiple sources from triggering same operation simultaneously
- Add early-return guards checking operation-in-progress flags

**Storage Optimization:**
- Debounce rapid operations (100-200ms delay recommended)
- Batch writes for bulk operations (Close All, multiple simultaneous state changes)
- Include unique saveId in storage writes to prevent hash collisions

**Cleanup Patterns:**
- All event listeners must be explicitly removed in destroy()
- Remove listeners before DOM removal, not after
- Verify cleanup completes before marking window as destroyed

<acceptance_criteria>
**Issue #1 (Critical):**
- [ ] Restore operation creates exactly one visible window
- [ ] UICoordinator.renderedTabs Map stays synchronized during minimize/restore cycle
- [ ] No duplicate DOM elements exist after restore
- [ ] Manual test: minimize tab → restore → verify only one window visible

**Issue #2:**
- [ ] Minimize operation executes exactly once per user action
- [ ] No "duplicate minimize request" warnings in logs
- [ ] Both Quick Tab button and Manager button work without conflicts

**Issue #3:**
- [ ] Position verification logs show actual final position
- [ ] No misleading offscreen (-9999px) positions logged after restore completes

**Issue #4:**
- [ ] Minimized count remains accurate during minimize/restore operations
- [ ] Storage persistence shows correct tab count at all times

**Issue #5:**
- [ ] No events fire after window destroy() completes
- [ ] Event listener cleanup verified in logs
- [ ] Manual test: destroy window → verify no subsequent events logged

**Issue #6:**
- [ ] Close All operation triggers at most 2 storage writes (initial + final)
- [ ] No write storms (>3 writes in <100ms) occur during bulk operations

**All Issues:**
- [ ] All existing tests pass
- [ ] No new console errors or warnings
- [ ] Manual integration test: create 3 tabs → minimize all → restore all → close all → verify clean state
- [ ] Memory leak test: create/destroy 50 tabs → verify no ghost listeners or leaked DOM
</acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #1: Detailed Flow Analysis</summary>

**Current (Broken) Flow:**
1. User clicks Restore in Manager
2. MinimizedManager.restore(id) applies snapshot to instance properties
3. QuickTabWindow.restore() checks `if (!this.container)` → TRUE (was cleared during minimize)
4. QuickTabWindow calls this.render() → Creates DOM element #1 at -9999px
5. requestAnimationFrame queues callback to move DOM #1 to target position
6. VisibilityHandler emits 'state:updated' event
7. UICoordinator receives event → calls update()
8. UICoordinator checks `if (!this.renderedTabs.has(quickTab.id))` → TRUE (Map was cleared during minimize)
9. UICoordinator calls render() → Creates DOM element #2 at -9999px
10. requestAnimationFrame queues callback to move DOM #2 to target position
11. Next browser paint cycle occurs
12. Both RAF callbacks execute, moving both elements to same position
13. Result: Two visible windows at identical coordinates

**Expected (Correct) Flow:**
1. User clicks Restore in Manager
2. MinimizedManager.restore(id) applies snapshot to instance properties
3. QuickTabWindow.restore() sets instance state but DOES NOT render
4. VisibilityHandler emits 'state:updated' event
5. UICoordinator receives event → calls update()
6. UICoordinator checks Map → not found → calls render() once
7. UICoordinator adds entry to renderedTabs Map
8. Single DOM element created and positioned correctly
9. Result: One visible window at correct position

**Key Insight:** The v1.6.4.6 addition of `isRendered()` check in UICoordinator WOULD prevent duplicates if Map entry existed, but Map is cleared during minimize so check never executes. Fix requires either keeping Map entries during minimize (with dormant flag) or having restore() not call render() internally.
</details>

<details>
<summary>Issue #2: Event Source Investigation</summary>

**Potential Duplicate Sources:**
1. Quick Tab window UI minimize button (quick-tabs/window.js button handler)
2. Manager panel minimize button (sidebar/quick-tabs-manager.js button handler)
3. Keyboard shortcut (if implemented)
4. Message handler receiving duplicate messages from background script

**Debounce Logic (v1.6.4.5):**
Current debounce implementation catches duplicates but doesn't prevent initial double-trigger. Both sources fire simultaneously, first completes, second hits debounce and logs warning.

**Recommended Investigation:**
- Add stack trace logging to identify which component(s) trigger duplicate calls
- Verify message passing doesn't duplicate messages between content script and background
- Check if event bubbling causes minimize button click to propagate to multiple handlers
</details>

<details>
<summary>Issue #5: Event Listener Audit Requirements</summary>

**Listeners to Verify:**
- Drag controller event listeners (mousedown, mousemove, mouseup)
- Resize controller event listeners (mousedown on resize handles)
- Focus/blur event listeners
- Click handlers on Quick Tab UI buttons
- Message listeners for background script communication
- Storage change listeners (if any at window level)

**Cleanup Pattern to Follow:**
Current destroy() logs show "Destroyed drag controller" and "Destroyed resize controller" but actual listener removal may be incomplete. Ensure controllers implement proper cleanup() or destroy() methods that explicitly remove all attached listeners.

**Verification Method:**
Add logging in event handlers showing listener execution. After destroy() completes, trigger events that would normally fire listeners. If any listeners execute post-destroy, cleanup is incomplete.
</details>

<details>
<summary>Architecture Context: Rendering Coordination</summary>

**Current Architecture Problem:**
Three components independently manage rendering without coordination:

1. **QuickTabWindow (window.js):** Owns DOM lifecycle, calls render() when `!this.container`
2. **UICoordinator (UICoordinator.js):** Tracks rendered tabs in Map, calls render() when Map entry missing
3. **MinimizedManager (minimized-manager.js):** Manages snapshots, triggers restore which initiates render

No single component has authority to say "this tab should render now" or "this tab is already rendered, don't render again."

**Recommended Architecture:**
- **UICoordinator:** Single rendering authority, all render decisions flow through it
- **QuickTabWindow:** Manages internal state and DOM structure, but never calls render() directly
- **MinimizedManager:** Applies snapshots and emits state change events, delegates rendering to UICoordinator
- **VisibilityHandler:** Coordinates state transitions, emits events, ensures UICoordinator receives notifications

**Synchronization Mechanism:**
UICoordinator.renderedTabs Map must be definitive source of truth. Options:
1. Keep Map entries during minimize, add `isMinimized` flag instead of removing entry
2. Have restore() update Map before any rendering occurs
3. Check actual DOM presence (document.getElementById) instead of only trusting Map

**RequestAnimationFrame Timing:**
Per MDN documentation, RAF callbacks execute before next paint (typically 16.67ms on 60Hz displays). When two render() calls happen in same millisecond (as logs show: 22:02:31.457 and 22:02:31.458), both RAF callbacks queue and both execute before paint. This is why both windows become visible - they're not being rendered sequentially, they're both rendering in same frame.
</details>

---

**Priority:** Critical (Issue #1), High (Issue #2), Medium (Issues #3-6) | **Target:** Single coordinated PR | **Estimated Complexity:** High (requires architectural refactoring)
