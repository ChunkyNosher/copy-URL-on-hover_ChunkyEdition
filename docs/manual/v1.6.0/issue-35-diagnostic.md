# Issue #35 Diagnostic Report: Quick Tab Cross-Tab Sync Failure

**Extension Version:** v1.6.2.0  
**Date:** 2025-11-25  
**Reporter:** User  
**Severity:** Critical

---

## Executive Summary

Quick Tabs created in one Wikipedia tab (Tab 1) completely disappear when switching to another Wikipedia tab (Tab 2), instead of syncing their position, size, and state as designed. The root cause is a **missing module import** in the UICoordinator that prevents Quick Tabs from rendering when tabs become visible after a cross-tab switch.

---

## Issue Description

### Expected Behavior (per #47 and #51)
When a user:
1. Opens a Quick Tab in Wikipedia Tab 1
2. Switches to Wikipedia Tab 2

The Quick Tab should:
- Remain visible in Wikipedia Tab 2
- Maintain its position, size, and z-index
- Sync its state across both tabs via `storage.onChanged` events

### Actual Behavior
When switching from Wikipedia Tab 1 to Wikipedia Tab 2:
- The Quick Tab **does not appear at all** in Tab 2
- No rendering occurs despite successful state synchronization

---

## Root Cause Analysis

### Critical Error in UICoordinator.js

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Line:** 184 (in `_createWindow` method)

#### The Problem

The `UICoordinator` class attempts to use a global function `createQuickTabWindow` that is **not available in scope**:

```javascript
/* global createQuickTabWindow */

export class UICoordinator {
  // ...
  _createWindow(quickTab) {
    // Use global createQuickTabWindow function
    // (This function is defined in window.js and attached to global scope)
    return createQuickTabWindow({  // ❌ UNDEFINED - Function not imported!
      id: quickTab.id,
      url: quickTab.url,
      // ...
    });
  }
}
```

#### Evidence from Logs

```
[2025-11-25T19:54:40.545Z] [ERROR] [SyncCoordinator] Error refreshing state on tab visible: {
  "type": "ReferenceError",
  "message": "createQuickTabWindow is not defined",
  "stack": "_createWindow@moz-extension://a61112d8-454d-4f20-b604-4b97cfdcf28d/content.js:1184:7
render@moz-extension://a61112d8-454d-4f20-b604-4b97cfdcf28d/content.js:1128:22
update@moz-extension://a61112d8-454d-4f20-b604-4b97cfdcf28d/content.js:1135:12..."
}
```

The error trace clearly shows:
1. Tab becomes visible → `SyncCoordinator.handleTabVisible()` fires
2. UICoordinator attempts to `render()` the Quick Tab
3. `_createWindow()` is called at line 1184
4. **`ReferenceError: createQuickTabWindow is not defined`** crashes the render

---

## Failure Sequence

### 1. Initial Creation (Tab 1) - Works ✅
```
User creates Quick Tab in Tab 1
  ↓
CreateHandler successfully creates window using proper factory
  ↓
Quick Tab renders and displays correctly
  ↓
State saved to storage.local
```

### 2. Tab Switch (Tab 1 → Tab 2) - Fails ❌
```
User switches to Tab 2
  ↓
EventManager detects tab visibility change
  ↓
SyncCoordinator.handleTabVisible() loads state from storage ✅
  ↓
StateManager.hydrate() emits 'state:updated' event ✅
  ↓
UICoordinator receives event and calls update() ✅
  ↓
update() calls _createWindow() because tab not yet rendered ✅
  ↓
_createWindow() tries to call createQuickTabWindow() ❌
  ↓
ReferenceError: Function not defined ❌
  ↓
Exception caught - render fails silently ❌
  ↓
Quick Tab never appears in Tab 2 ❌
```

---

## Why Initial Creation Works But Cross-Tab Fails

### Initial Creation Path (Working)
- Uses `CreateHandler.create()` method
- CreateHandler has proper access to window factory
- Factory is injected as a dependency
- No reliance on global scope

### Cross-Tab Render Path (Broken)
- Uses `UICoordinator._createWindow()` method
- Attempts to call `createQuickTabWindow` from global scope
- Function is **not** attached to global scope
- Comment in code says "defined in window.js and attached to global scope" but this is **incorrect**

---

## Code Analysis

### UICoordinator.js (Current - Broken)

```javascript
/**
 * Create QuickTabWindow from QuickTab entity
 * @private
 */
_createWindow(quickTab) {
  // Use global createQuickTabWindow function
  // (This function is defined in window.js and attached to global scope)
  return createQuickTabWindow({  // ❌ Not actually global!
    id: quickTab.id,
    url: quickTab.url,
    // ...
  });
}
```

### What's Missing

The `createQuickTabWindow` function from `src/features/quick-tabs/window.js` is **never imported or made available** to UICoordinator. The `/* global createQuickTabWindow */` comment is a JSLint directive that only suppresses linting warnings - it doesn't actually import or define anything.

---

## Impact Assessment

### Scope
- **Affects:** ALL Quick Tabs across ALL tabs
- **Trigger:** Any tab switch after Quick Tab creation
- **Frequency:** 100% reproducible

### User Experience
- Quick Tabs appear to "vanish" when switching tabs
- Users lose access to their floating windows
- Feature appears completely broken for multi-tab workflows
- State sync mechanism (storage.onChanged) works correctly but rendering fails

### Data Integrity
- ✅ No data loss - state is saved correctly to storage
- ✅ Background sync works - storage.onChanged fires properly
- ✅ State merge logic works - tabs detect newer timestamps
- ❌ UI rendering completely fails on cross-tab refresh

---

## Related Systems Working Correctly

The logs show several systems ARE functioning as designed:

1. **Storage Sync** ✅
   ```
   [StorageManager] Storage changed: local ["quick_tabs_state_v2"]
   [StorageManager] Processing storage change
   ```

2. **State Management** ✅
   ```
   [StateManager] Hydrate called
   [SyncCoordinator] Loaded 12 Quick Tabs globally from storage
   ```

3. **Event Bus** ✅
   ```
   [UICoordinator] Received state:updated event
   ```

4. **Tab Visibility Detection** ✅
   ```
   [EventManager] Tab visible - triggering state refresh
   [SyncCoordinator] Tab became visible - refreshing state from storage
   ```

The **only** failing component is the UI rendering in `UICoordinator._createWindow()`.

---

## Recommended Fix

### Option 1: Import Factory Function (Preferred)

**Modify:** `src/features/quick-tabs/coordinators/UICoordinator.js`

```javascript
import { createQuickTabWindow } from '../window.js';

export class UICoordinator {
  // ...existing code...
  
  _createWindow(quickTab) {
    return createQuickTabWindow({
      id: quickTab.id,
      url: quickTab.url,
      // ...
    });
  }
}
```

### Option 2: Inject Factory via Constructor

```javascript
export class UICoordinator {
  constructor(stateManager, minimizedManager, panelManager, eventBus, windowFactory) {
    this.stateManager = stateManager;
    this.minimizedManager = minimizedManager;
    this.panelManager = panelManager;
    this.eventBus = eventBus;
    this.windowFactory = windowFactory;  // ← Inject factory
    this.renderedTabs = new Map();
  }
  
  _createWindow(quickTab) {
    return this.windowFactory({
      id: quickTab.id,
      url: quickTab.url,
      // ...
    });
  }
}
```

### Option 3: Pass Factory to Render Method

```javascript
render(quickTab, windowFactory) {
  if (this.renderedTabs.has(quickTab.id)) {
    return this.renderedTabs.get(quickTab.id);
  }
  
  const tabWindow = windowFactory({
    id: quickTab.id,
    url: quickTab.url,
    // ...
  });
  
  this.renderedTabs.set(quickTab.id, tabWindow);
  return tabWindow;
}
```

---

## Testing Recommendations

### Test Case 1: Basic Cross-Tab Sync
1. Open two Wikipedia tabs (Tab 1, Tab 2)
2. In Tab 1, create a Quick Tab
3. Switch to Tab 2
4. **Verify:** Quick Tab appears in Tab 2 with same position/size

### Test Case 2: Multiple Quick Tabs
1. In Tab 1, create 3 Quick Tabs at different positions
2. Switch to Tab 2
3. **Verify:** All 3 Quick Tabs appear with correct positions

### Test Case 3: Position/Size Sync
1. Create Quick Tab in Tab 1
2. Move and resize it
3. Switch to Tab 2
4. **Verify:** Quick Tab appears with updated position and size

### Test Case 4: State Changes
1. Create Quick Tab in Tab 1
2. Minimize it
3. Switch to Tab 2
4. **Verify:** Quick Tab appears minimized (or in minimized list)

---

## Conclusion

Issue #35 is caused by a **missing module import** in `UICoordinator.js`. The function `createQuickTabWindow` is never imported, causing a `ReferenceError` when the coordinator attempts to render Quick Tabs after a tab switch. 

The cross-tab synchronization mechanism (storage.onChanged, state hydration, event bus) works perfectly - the failure occurs **only** at the final rendering step due to the missing dependency.

**Fix Complexity:** Low  
**Fix Risk:** Low (isolated to one dependency)  
**Estimated Effort:** 15 minutes

---

## Appendix: Key Log Excerpts

### Successful State Load
```
[SyncCoordinator] Tab became visible - refreshing state from storage
[StorageManager] Loaded 12 Quick Tabs from container: firefox-default
[SyncCoordinator] Loaded 12 Quick Tabs globally from storage
```

### Failed Render Attempt
```
[UICoordinator] Received state:updated event
[UICoordinator] Tab not rendered, rendering now: qt-1764020276825-pukichn1s
[UICoordinator] Rendering tab: qt-1764020276825-pukichn1s
[ERROR] [SyncCoordinator] Error refreshing state on tab visible:
  ReferenceError: createQuickTabWindow is not defined
  at _createWindow@content.js:1184:7
```