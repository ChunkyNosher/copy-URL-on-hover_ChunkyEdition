# Storage Listener Memory Leak & Resource Cleanup Issues

**Extension Version:** v1.6.4+  
**Date:** 2025-12-01  
**Scope:** Critical memory leak from uncalled cleanup methods

---

## Executive Summary

The CreateHandler implements a storage listener cleanup method (`destroy()`) but
this method is never invoked during the extension lifecycle. This creates a
**memory leak** where storage listeners accumulate across page reloads and tab
navigation. Additionally, the QuickTabsManager lacks any cleanup/teardown
methods entirely, meaning no resources are released when pages unload.

**Impact:**

- Storage listeners accumulate indefinitely across page reloads
- Memory usage grows proportionally to navigation frequency
- Performance degradation in long-running browser sessions
- Event handler duplication may cause race conditions

**Root Cause:** The facade pattern implementation in QuickTabsManager properly
initializes handlers but provides no corresponding teardown logic. Page
unload/navigation events do not trigger any cleanup routines.

---

## Issues Overview

| #   | Component         | Severity | Root Cause                                          |
| --- | ----------------- | -------- | --------------------------------------------------- |
| 1   | CreateHandler     | Critical | `destroy()` method exists but never called          |
| 2   | QuickTabsManager  | Critical | No cleanup/teardown method implemented              |
| 3   | Content Script    | High     | No beforeunload handler to trigger cleanup          |
| 4   | Sidebar Listeners | Low      | Acceptable - separate context handles own lifecycle |

**Why bundled:** All issues stem from missing lifecycle management in the facade
architecture. Can be resolved with centralized teardown pattern in
QuickTabsManager.

<scope>
**Modify:**
- `src/features/quick-tabs/index.js` (QuickTabsManager class)
- `src/content.js` (page unload handler)

**Do NOT Modify:**

- `src/features/quick-tabs/handlers/CreateHandler.js` (destroy method already
  correct)
- `sidebar/panel.js` (separate context, acceptable as-is)
- `sidebar/quick-tabs-manager.js` (separate context, acceptable as-is) </scope>

---

## Issue 1: CreateHandler.destroy() Never Called

**Problem:** CreateHandler implements proper storage listener cleanup in
`destroy()` method, but this method is never invoked by QuickTabsManager or any
other component.

**Root Cause:**

- **File:** `src/features/quick-tabs/index.js`
- **Location:** QuickTabsManager class (no destroy method)
- **Issue:** CreateHandler is initialized during manager setup but no teardown
  path exists

**Current State:**

```
Initialization: createHandler.init() → storage listener added ✓
Teardown: (none) → storage listener never removed ✗
```

**Fix Required:** Add QuickTabsManager.destroy() method that calls
createHandler.destroy() along with cleanup for other handlers. Ensure this new
method is invoked on page unload.

---

## Issue 2: QuickTabsManager Missing Cleanup Method

**Problem:** QuickTabsManager facade has no `destroy()` or `cleanup()` method
despite managing multiple stateful components (handlers, managers, coordinators,
MemoryGuard).

**Root Cause:**

- **File:** `src/features/quick-tabs/index.js`
- **Location:** QuickTabsManager class (lines 1-900+)
- **Issue:** Facade pattern implements initialization methods (Steps 1-7) but no
  corresponding teardown

**Components Needing Cleanup:**

- CreateHandler (storage listener)
- MemoryGuard (monitoring interval)
- Event listeners on internalEventBus
- DOM elements from all open Quick Tabs

**Fix Required:** Implement QuickTabsManager.destroy() method that:

- Stops MemoryGuard monitoring
- Calls createHandler.destroy() to remove storage listener
- Closes all Quick Tabs (DOM cleanup via closeAll())
- Removes all event listeners from internalEventBus

---

## Issue 3: No Page Unload Handler in Content Script

**Problem:** Content script initializes QuickTabsManager but never registers a
beforeunload handler to trigger cleanup when user navigates away or reloads
page.

**Root Cause:**

- **File:** `src/content.js`
- **Location:** After `initQuickTabs()` call (no cleanup registration)
- **Issue:** Window lifecycle events not wired to manager teardown

**Current Lifecycle:**

```
Page Load → initExtension() → initQuickTabs() → manager initialized ✓
Page Unload → (no handler) → manager instance orphaned ✗
```

**Fix Required:** Add window.addEventListener('beforeunload', ...) handler that
calls quickTabsManager.destroy() if the manager exists and has a destroy method.

---

## Issue 4: Sidebar Storage Listeners (Acceptable)

**Problem:** Both `sidebar/panel.js` and `sidebar/quick-tabs-manager.js`
register storage.onChanged listeners without explicit cleanup.

**Root Cause:**

- **Files:** `sidebar/panel.js` (line 283), `sidebar/quick-tabs-manager.js`
  (line 513)
- **Issue:** Listeners registered in sidebar context

**Why Acceptable:** These listeners exist in the sidebar panel context (separate
from content scripts). When the sidebar is closed, the entire context is
destroyed along with its listeners. This is standard browser behavior for
sidebar panels and does not require manual cleanup.

**No Action Required** - Architecture as designed.

---

## Shared Implementation Notes

- Follow established teardown patterns from MemoryGuard (has stopMonitoring
  method)
- Ensure destroy() is idempotent (safe to call multiple times)
- Log cleanup actions for debugging (match initialization logging verbosity)
- Consider checking `this.initialized` flag before cleanup
- Use optional chaining when calling destroy on potentially undefined handlers

**Architecture Context:** The QuickTabsManager facade uses Step 1-7
initialization pattern. A corresponding cleanup pattern should mirror this
structure in reverse order.

---

<acceptancecriteria>
**Issue 1:**
- CreateHandler.destroy() is called during manager teardown
- Console logs confirm "Storage listener removed"
- No storage listeners remain after page reload

**Issue 2:**

- QuickTabsManager.destroy() method exists and is callable
- Method stops MemoryGuard monitoring
- Method removes all event listeners from internalEventBus
- Method closes all Quick Tabs (DOM cleanup)

**Issue 3:**

- beforeunload event triggers manager cleanup
- Console logs confirm cleanup on page navigation
- Memory usage stable across 10+ page reloads

**All Issues:**

- Existing functionality unaffected
- No new console errors or warnings
- Manual test: Create Quick Tab → Reload page 10x → Check DevTools memory
  profiler for listener accumulation </acceptancecriteria>

---

## Supporting Context

<details>
<summary>Memory Leak Evidence</summary>

**Behavior:**

1. Load page → CreateHandler.init() adds storage listener
2. Reload page → New CreateHandler instance adds another listener
3. Old listener remains active in memory (never removed)
4. Repeat across multiple tabs/reloads → exponential listener growth

**Detection:** Search codebase for calls to `createHandler.destroy()` returns 0
results. Search for `QuickTabsManager.prototype.destroy` or similar cleanup
methods returns 0 results.

**Verification Steps:**

1. Open DevTools → Memory → Take heap snapshot
2. Create Quick Tab
3. Reload page 5 times
4. Take second heap snapshot
5. Compare → Look for multiple browser.storage.onChanged listener instances
</details>

<details>
<summary>Architectural Pattern Analysis</summary>

**Current Initialization Pattern (Steps 1-7):**

```
_initStep1_Context() → Detect container/tab
_initStep2_Managers() → Initialize managers
_initStep3_Handlers() → Initialize handlers (calls createHandler.init())
_initStep4_Coordinators() → Initialize coordinators
_initStep5_Setup() → Setup components
_initStep6_Hydrate() → Hydrate state from storage
_initStep7_Expose() → Expose manager globally
```

**Missing Teardown Pattern:** No corresponding Steps 7-1 in reverse for cleanup.
Best practice would be:

```
_teardownStep1_Unexpose() → Remove global references
_teardownStep2_Storage() → Cancel pending saves
_teardownStep3_Coordinators() → Cleanup coordinators
_teardownStep4_Handlers() → Cleanup handlers (call destroy())
_teardownStep5_Managers() → Stop monitoring
_teardownStep6_Events() → Remove all listeners
_teardownStep7_DOM() → Close all Quick Tabs
```

However, a simpler single destroy() method is sufficient for this use case.

</details>

<details>
<summary>Sidebar Context Explanation</summary>

**Why sidebar listeners are acceptable:**

Sidebar panels in Firefox/Chrome run in isolated contexts separate from content
scripts. When the sidebar closes:

1. Browser garbage collects the entire sidebar context
2. All variables, functions, and event listeners are destroyed
3. No manual cleanup required

**Difference from content scripts:** Content scripts remain active as long as
the page is loaded. If the page stays open but is backgrounded, listeners
accumulate. Content scripts need manual cleanup on beforeunload.

**Reference:** MDN Web Extensions API - Sidebars lifecycle management

</details>

---

**Priority:** Critical  
**Target:** Implement destroy() method + beforeunload handler  
**Estimated Complexity:** Low (straightforward cleanup pattern)

---

## Additional Missing Logging

While investigating storage listeners, several logging gaps were identified:

### Missing Debug Logs in CreateHandler

**Issue:** Storage listener setup has verbose logging, but no corresponding logs
for:

- When settings are loaded during init()
- When updateAllQuickTabsDebugDisplay() executes
- Number of tabs updated during setting changes

**Recommendation:** Add console.log statements in:

- `_loadDebugIdSetting()` success/failure paths
- `_updateAllQuickTabsDebugDisplay()` before and after loop
- Storage listener callback when quickTabShowDebugId changes

### Missing Lifecycle Logs in QuickTabsManager

**Issue:** Initialization has detailed Step 1-7 logging, but no logs for:

- When handlers are garbage collected
- When page unload is detected
- Memory usage at teardown time

**Recommendation:** Add logging to new destroy() method matching initialization
verbosity.

### Missing Cross-Tab Sync Logs

**Issue:** Storage changes trigger UI updates but no logs indicate:

- Which tab triggered the storage change
- Whether storage change was local or remote
- Debounce timing information

**Recommendation:** Enhance storage.onChanged listener logging in sidebar files
with timing data and source tab identification.

---

## Degraded Code Quality Observations

### Inconsistent Error Handling

**Pattern Found:** Some methods use try-catch with detailed logging, others
silently fail.

**Examples:**

- `_hydrateStateFromStorage()` has comprehensive error handling ✓
- `_handleManagerAction()` catches errors and logs them ✓
- `minimizeById()` has no error handling ✗
- `restoreById()` has no error handling ✗

**Recommendation:** Standardize error handling across all public API methods in
QuickTabsManager.

### Missing JSDoc Documentation

**Issue:** Many helper methods lack JSDoc comments explaining:

- Parameter types and purposes
- Return value meaning
- Side effects or state changes

**Examples of undocumented methods:**

- `_generateIdCandidate()`
- `_buildHydrationOptions()`
- `_hydrateVisibleTab()`
- `_hydrateMinimizedTab()`

**Recommendation:** Add JSDoc to all private helper methods for better code
maintainability.

### Complexity Debt in Sidebar Manager

**Issue:** `sidebar/quick-tabs-manager.js` has grown to 900+ lines with:

- Multiple concerns mixed (rendering, storage, reconciliation, UI events)
- Deep nesting in reconciliation logic
- Large functions exceeding 50 lines

**Recommendation:** Refactor sidebar manager into separate modules:

- `sidebar/rendering.js` for UI generation
- `sidebar/storage.js` for storage operations
- `sidebar/reconciliation.js` for conflict resolution

### Unused Event Bridge

**Issue:** Event bridge in QuickTabsManager bridges internal → external events,
but no code appears to listen to these bridged events.

**Investigation Needed:**

- Are bridged events actually consumed?
- Can event bridge be removed to reduce complexity?
- Document why bridge exists if required for backward compatibility

---

**End of Report**
