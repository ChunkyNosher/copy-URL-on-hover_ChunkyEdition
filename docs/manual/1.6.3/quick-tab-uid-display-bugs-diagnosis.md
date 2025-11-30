# Quick Tab UID Display Feature - Multiple Critical Bugs

**Extension Version:** v1.6.3.2  
**Date:** 2025-11-30  
**Scope:** UID display feature for Quick Tabs (debug ID indicator in titlebar)

---

## Executive Summary

The Quick Tab UID display feature has multiple critical defects that make it nearly unusable. All Quick Tabs created within the same browser tab display identical truncated UIDs, making individual tab identification impossible. Additionally, the UID indicator disappears entirely when a Quick Tab is minimized and then restored. Log analysis reveals several related architectural issues: UID generation uses browser tab ID as the first component (causing identical prefixes), the minimize/restore cycle destroys and recreates DOM without preserving the `showDebugId` setting, and separate settings loading mechanisms in UICoordinator and CreateHandler can lead to desynchronization.

## Issues Overview

| # | Issue                              | Component         | Severity | Root Cause                                    |
|---|------------------------------------|-------------------|----------|-----------------------------------------------|
| 1 | All UIDs display identically       | ID Generation     | Critical | Browser tab ID used in format + truncation   |
| 2 | UID disappears after restore       | Window/Titlebar   | Critical | DOM destroyed on minimize, setting not passed |
| 3 | "Tab not found" warnings           | VisibilityHandler | Medium   | MinimizedManager not consulted correctly      |
| 4 | Duplicate iframe processing logs   | Event handlers    | Low      | Multiple code paths logging same event        |
| 5 | Settings loading desync            | Storage access    | Medium   | UICoordinator and CreateHandler separate loads|

**Why bundled:** All issues affect the same UID display feature and stem from architectural decisions around ID generation, state management, and DOM lifecycle. Fixing these requires coordinated changes across ID generation, window restoration, and settings synchronization.

---

<scope>
**Modify:**
- `src/features/quick-tabs/index.js` (generateId method)
- `src/features/quick-tabs/window.js` (restore, render methods)
- `src/features/quick-tabs/window/TitlebarBuilder.js` (UID display logic)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (minimize/restore flow)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (settings loading)

**Do NOT Modify:**
- `src/background/` (out of scope)
- `src/features/quick-tabs/handlers/CreateHandler.js` (settings loading is correct)
- Storage persistence mechanisms (working correctly)
</scope>

---

## Issue 1: All Quick Tabs Display Identical UID

### Problem
When multiple Quick Tabs are created in the same browser tab (e.g., tab ID 121), all UID indicators display identical text like `qt-121-17...`, making it impossible to distinguish between different Quick Tabs using the debug ID feature.

### Root Cause

**File:** `src/features/quick-tabs/index.js`  
**Location:** `_generateIdCandidate()` method (lines ~550-555)  
**Issue:** UID format is `qt-{tabId}-{timestamp}-{random}`. The browser tab ID (e.g., 121) is the same for all Quick Tabs created within that tab, so the first 7 characters (`qt-121-`) are identical.

**File:** `src/features/quick-tabs/window/TitlebarBuilder.js`  
**Location:** `_createDebugIdElement()` method (lines ~383-385)  
**Issue:** Display logic truncates UIDs longer than 15 characters to first 12 chars + `...`. Since all UIDs start with `qt-121-1764...` (tab ID + timestamp prefix), the truncated display is identical for all Quick Tabs created within ~1 second of each other.

**Evidence from logs:**
```
qt-121-1764522381209-1294jc4k13j2u  (HololiveProduction)
qt-121-1764522384088-1yrwy7v19axxbi (OozoraSubaru)
qt-121-1764522396417-1f5r09s9wvia8  (Yokkaichi)
```
All display as: `qt-121-1764...`

### Fix Required

Change UID generation to **not** use browser tab ID as a component, or use a different truncation/display strategy that shows the unique portion (timestamp + random suffix). Options include:

1. **Remove tab ID from UID format entirely** - use only timestamp + random suffix
2. **Show last N characters instead of first N** - display the unique random suffix
3. **Use sequential counter** - replace tab ID with instance-specific counter that increments per Quick Tab

The chosen approach must ensure visually distinct UIDs when displayed in truncated form while maintaining uniqueness guarantees for the full ID.

---

## Issue 2: UID Indicator Disappears After Minimize/Restore

### Problem
When a Quick Tab is minimized and then restored, the UID indicator in the titlebar disappears completely, even though the setting `quickTabShowDebugId` remains enabled in storage.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `minimize()` method (lines 695-720)  
**Issue:** The minimize operation **destroys the entire DOM** including the TitlebarBuilder instance. All references are set to null:
```javascript
this.container.remove();
this.container = null;
this.titlebarBuilder = null;
this.rendered = false;
```

**File:** `src/features/quick-tabs/window.js`  
**Location:** `restore()` method (lines 732-766)  
**Issue:** The restore method **does NOT call render()** directly. It only updates `this.minimized = false` and logs that "UICoordinator will render". The comment states this is intentional to prevent duplicate rendering.

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Settings initialization (referenced in logs at `17:05:59.154`)  
**Issue:** When UICoordinator calls `render()` after restore, it creates a **new TitlebarBuilder instance**. However, UICoordinator has its own separate settings loading mechanism that logs "Both sync and local storage failed, using default showDebugId false". This means the new TitlebarBuilder is constructed with `showDebugId: false` even though CreateHandler has `showDebugId: true`.

**Evidence from logs:**
```
17:06:44.995 - MINIMIZEQUICKTAB request qt-121-1764522381209-1294jc4k13j2u
17:06:47.655 - RESTOREQUICKTAB request qt-121-1764522381209-1294jc4k13j2u
17:06:47.827 - Quick Tabs Processing iframe (DOM rebuilt)
```
No "Added debug ID element" log appears after restore, confirming UID element is not recreated.

### Fix Required

Ensure `showDebugId` setting is **properly passed** when UICoordinator renders a restored Quick Tab. Options:

1. **Pass showDebugId in render call** - UICoordinator should read current `quickTabShowDebugId` from storage before calling render
2. **Preserve showDebugId on QuickTabWindow instance** - ensure `this.showDebugId` is maintained through minimize/restore cycle
3. **Unify settings loading** - make UICoordinator use same settings source as CreateHandler instead of separate loading logic

The restore flow must guarantee that any Quick Tab created with debug ID enabled maintains that setting through minimize/restore cycles.

---

## Issue 3: "Tab not found in minimized manager" Warnings

### Problem
Every minimize and restore operation logs warnings like:
- `WARN VisibilityHandler Tab not found for minimize qt-121-...`
- `WARN VisibilityHandler Tab not found in minimized manager qt-121-...`

Yet the operations complete successfully, suggesting the warnings are spurious or the MinimizedManager is not being used as the authoritative state tracker.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` and `handleRestore()` methods  
**Issue:** The code checks `quickTabsMap.get(id)` which returns the QuickTabWindow instance, but does **not** check if the tab already exists in MinimizedManager before adding it. Similarly, restore warns "tab not found in minimized manager" but succeeds anyway because the state is stored on the QuickTabWindow instance itself (`this.minimized`), not in the MinimizedManager.

This suggests a **dual state storage pattern** where:
- `QuickTabWindow.minimized` tracks the state on the instance
- `MinimizedManager` is intended to track position/size snapshots
- But the code flow doesn't properly coordinate between the two

**Evidence from logs:**
```
17:06:44.995 - WARN VisibilityHandler Tab not found for minimize qt-121-...
17:06:44.995 - LOG Content Minimized Quick Tab (success!)
```
Warning appears but operation succeeds, indicating the check is incorrect or the manager is not the source of truth.

### Fix Required

Clarify the **responsibility boundary** between QuickTabWindow instance state and MinimizedManager state. Either:

1. **Make MinimizedManager authoritative** - always check manager state before operations, suppress warnings if not using manager pattern
2. **Remove MinimizedManager checks** - if QuickTabWindow.minimized is the source of truth, remove the manager lookups causing false warnings
3. **Synchronize both** - ensure MinimizedManager is always updated when QuickTabWindow.minimized changes

The chosen approach must eliminate spurious warnings while maintaining correct minimize/restore functionality.

---

## Issue 4: Duplicate "Processing iframe" Logs

### Problem
After Quick Tab restore operations, logs show duplicate "Processing iframe" entries with timestamps ~1-3ms apart:
```
17:06:29.048 - DEBUG Quick Tabs Processing iframe ...
17:06:29.049 - DEBUG Quick Tabs Processing iframe ...
```

### Root Cause

**File:** Background script iframe handlers (exact file not determined from logs)  
**Location:** Likely in declarativeNetRequest or webRequest handlers  
**Issue:** When a Quick Tab is restored and `render()` creates a new iframe, **two separate code paths** both log "Processing iframe":
1. One from initial iframe creation (setting `src` attribute)
2. Another from the iframe `load` event listener

This suggests either:
- Multiple event listeners attached to same iframe
- Event listener not cleaned up from previous minimize cycle
- Two different handlers both processing the same iframe load

**Evidence from logs:**
All duplicate logs occur **immediately after RESTOREQUICKTAB** operations, with <5ms separation between log entries.

### Fix Required

Identify the **two logging locations** for "Processing iframe" and either:

1. **Consolidate logging** - log only once per iframe load (remove duplicate log statement)
2. **Distinguish log messages** - make logs clearly indicate which code path is executing
3. **Remove redundant handler** - if two handlers do the same work, remove one

This is a minor issue but indicates inefficiency in event handling during restore operations.

---

## Issue 5: UICoordinator and CreateHandler Load Settings Separately

### Problem
CreateHandler successfully loads `quickTabShowDebugId` from `storage.local`, but UICoordinator logs "Both sync and local storage failed, using default showDebugId false". This means the two components have **different values** for the same setting.

### Root Cause

**File:** `src/features/quick-tabs/handlers/CreateHandler.js`  
**Location:** `_loadDebugIdSetting()` method (lines 108-118)  
**Issue:** CreateHandler correctly loads individual key `quickTabShowDebugId` from `storage.local`:
```javascript
const result = await browser.storage.local.get('quickTabShowDebugId');
this.showDebugIdSetting = result.quickTabShowDebugId ?? false;
```

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Settings initialization (referenced in logs)  
**Issue:** UICoordinator attempts to load settings from **both** `storage.sync` and `storage.local` but fails at both. The log at `17:05:59.154` states:
```
LOG UICoordinator Both sync and local storage failed, using default showDebugId false
```

This indicates UICoordinator is either:
- Looking for settings under a **different key** than CreateHandler
- Trying to read a nested settings object that doesn't exist
- Using an outdated storage access pattern

**Impact:** When UICoordinator calls `render()` on a restored Quick Tab, it passes `showDebugId: false` to TitlebarBuilder even though the user has the setting enabled.

### Fix Required

**Unify settings loading** across all components. Options:

1. **Make UICoordinator use CreateHandler's settings** - read from same location (`quickTabShowDebugId` in `storage.local`)
2. **Create shared settings accessor** - extract settings loading to a utility function both components use
3. **Remove UICoordinator settings loading** - if CreateHandler is authoritative, UICoordinator should query it instead of storage

The solution must ensure **both components always have the same value** for `quickTabShowDebugId` at all times.

---

## Shared Implementation Notes

- **Do NOT use browser tab ID in UID format** - it causes all UIDs in same tab to have identical prefix
- **Preserve `showDebugId` through minimize/restore** - either on QuickTabWindow instance or re-read from storage before render
- **Single source of truth for settings** - all components must read from same storage location with same key
- **Clean up event listeners on minimize** - prevent duplicate handlers when DOM is recreated
- **MinimizedManager vs instance state** - clarify which is authoritative to eliminate false warnings

<acceptance_criteria>
**Issue 1 - Distinct UIDs:**
- Each Quick Tab displays a unique, visually distinguishable UID when truncated to 15 characters
- UIDs created within same browser tab do NOT share identical prefix
- Manual test: Create 3 Quick Tabs in same tab, verify all show different UIDs

**Issue 2 - UID Persistence:**
- UID indicator remains visible after minimize/restore cycle
- Setting `quickTabShowDebugId=true` is respected in restored Quick Tabs
- Manual test: Enable debug IDs, create Quick Tab, minimize, restore → UID still visible

**Issue 3 - No False Warnings:**
- No "Tab not found" warnings during normal minimize/restore operations
- MinimizedManager state correctly reflects actual minimized tabs
- Manual test: Minimize/restore 5 times, verify zero warnings in console

**Issue 4 - Single Iframe Log:**
- Only one "Processing iframe" log per actual iframe load event
- No duplicate logs with <5ms separation
- Manual test: Restore Quick Tab, verify single "Processing iframe" log

**Issue 5 - Unified Settings:**
- CreateHandler and UICoordinator load `showDebugId` from same location
- Both components always have identical setting values
- Manual test: Toggle debug ID setting, verify both components detect change

**All Issues:**
- All existing Quick Tab tests pass
- No new console errors or warnings
- Browser tab ID is NOT visible in displayed UIDs
</acceptance_criteria>

---

## Supporting Context

<details>
<summary>Log Evidence - Issue 1 (Identical UIDs)</summary>

All Quick Tabs created in browser tab 121 show UIDs starting with `qt-121-`:
```
17:06:21.213 - Create ID qt-121-1764522381209-1294jc4k13j2u (HololiveProduction)
17:06:24.100 - Create ID qt-121-1764522384088-1yrwy7v19axxbi (OozoraSubaru)  
17:06:36.429 - Create ID qt-121-1764522396417-1f5r09s9wvia8 (Yokkaichi)
17:07:31.716 - Create ID qt-121-1764522451712-19cc92y1rmfrbl (MiePrefecture)
17:07:43.604 - Create ID qt-121-1764522463597-5l3l831xpoag8 (Yokkaichi)
17:07:55.506 - Create ID qt-121-1764522475502-yj4642b49s5r (Personalname)
```

With 15-character truncation (12 chars + "..."), all display as: `qt-121-1764...`

The timestamp and random suffix **are unique** but get hidden by the display truncation.
</details>

<details>
<summary>Log Evidence - Issue 2 (UID Disappears)</summary>

UID setting enabled at initialization:
```
17:05:59.011 - CreateHandler Loaded showDebugId from storage.local: false
17:07:23.304 - CreateHandler Debug ID setting changed: oldValue=false, newValue=true
17:07:23.304 - CreateHandler Updated debug ID display on 0 Quick Tabs
```

Restore sequence shows no UID recreation:
```
17:06:58.891 - RESTOREQUICKTAB request qt-121-1764522381209-1294jc4k13j2u
17:06:58.891 - VisibilityHandler Handling restore
17:06:58.891 - WARN VisibilityHandler Tab not found in minimized manager
17:06:59.142 - Quick Tabs Processing iframe (DOM rebuilt)
```

No log entry for "Added debug ID element dynamically" after restore, confirming UID element is not recreated.

UICoordinator settings failure:
```
17:05:59.154 - UICoordinator Both sync and local storage failed, using default showDebugId false
```
</details>

<details>
<summary>Log Evidence - Issue 3 (False Warnings)</summary>

Every minimize operation shows warning despite success:
```
17:06:44.995 - MINIMIZEQUICKTAB request qt-121-1764522381209-1294jc4k13j2u
17:06:44.995 - VisibilityHandler Minimize button clicked
17:06:44.995 - WARN VisibilityHandler Tab not found for minimize
17:06:44.995 - LOG Content Minimized Quick Tab (SUCCESS)
```

Every restore operation shows warning despite success:
```
17:06:47.655 - RESTOREQUICKTAB request qt-121-1764522381209-1294jc4k13j2u  
17:06:47.655 - VisibilityHandler Handling restore
17:06:47.655 - WARN VisibilityHandler Tab not found in minimized manager
17:06:47.655 - LOG Content Restored Quick Tab (SUCCESS)
```

Pattern repeats for all minimize/restore cycles throughout entire log file.
</details>

<details>
<summary>Log Evidence - Issue 4 (Duplicate Logs)</summary>

Duplicate "Processing iframe" logs appear after every restore:
```
17:06:29.048 - DEBUG Quick Tabs Processing iframe (OozoraSubaru)
17:06:29.049 - DEBUG Quick Tabs Processing iframe (OozoraSubaru)
```

```
17:06:30.345 - DEBUG Quick Tabs Processing iframe (HololiveProduction)
17:06:30.345 - DEBUG Quick Tabs Processing iframe (HololiveProduction)
```

```
17:07:00.468 - DEBUG Quick Tabs Processing iframe (Yokkaichi)
17:07:00.471 - DEBUG Quick Tabs Processing iframe (Yokkaichi)
```

Timestamps are 1-3ms apart, suggesting synchronous or near-synchronous execution of two separate logging statements for the same event.
</details>

<details>
<summary>Architecture Context - ID Generation</summary>

Current UID format: `qt-{tabId}-{timestamp}-{random}`

**Components:**
- `qt-` prefix (3 chars)
- Browser tab ID (1-4 digits, e.g., "121")
- Timestamp in milliseconds (13 digits, e.g., "1764522381209")
- Cryptographically secure random string (~13 chars, e.g., "1294jc4k13j2u")

**Total length:** ~32-35 characters

**Display truncation:** First 12 characters + "..." if length > 15

**Problem:** First 7-10 characters (`qt-121-1764...`) are identical for all Quick Tabs created in same browser tab within ~1 second, making truncated display non-unique.

**Solution space:**
1. Remove tab ID component entirely
2. Show last N characters instead of first N
3. Use sequential instance counter instead of tab ID
4. Increase truncation threshold or change truncation position
</details>

<details>
<summary>Architecture Context - Minimize/Restore Flow</summary>

**Minimize sequence:**
1. `VisibilityHandler.handleMinimize()` called
2. `MinimizedManager.add(id, tabWindow)` stores snapshot
3. `tabWindow.minimize()` destroys DOM:
   - Pauses media
   - Destroys DragController
   - Destroys ResizeController  
   - Calls `this.container.remove()`
   - Sets `this.container = null`, `this.titlebarBuilder = null`
   - Sets `this.rendered = false`
4. State persisted to storage

**Restore sequence:**
1. `VisibilityHandler.handleRestore()` called
2. `MinimizedManager.restore(id)` retrieves snapshot (position/size)
3. `tabWindow.restore()` updates state:
   - Sets `this.minimized = false`
   - Updates position/size properties
   - **Does NOT call render()** (intentional - UICoordinator will render)
   - Logs "Container is null during restore (expected)"
4. `UICoordinator.update()` detects state change
5. `UICoordinator` calls `tabWindow.render()` which:
   - Creates new container, iframe, titlebar
   - Creates **new TitlebarBuilder instance** with config
   - **Config includes `showDebugId` from `this.showDebugId`**
   - But UICoordinator may have overridden this with its own settings load

**Critical gap:** `showDebugId` value not guaranteed to persist from minimize to restore.
</details>

---

**Priority:** Critical (Issues 1-2), Medium (Issues 3-5)  
**Target:** Single coordinated PR addressing all issues  
**Estimated Complexity:** Medium-High
