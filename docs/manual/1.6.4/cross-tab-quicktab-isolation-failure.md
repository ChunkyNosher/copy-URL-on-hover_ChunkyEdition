# Quick Tab Cross-Tab Isolation Failure & State Sync Issues

**Extension Version:** v1.6.3.6-v2  
**Date:** December 5, 2025  
**Scope:** Quick Tabs appearing on all tabs despite v1.6.3 isolation refactor

---

## Executive Summary

Quick Tabs that should be isolated per browser tab are instead appearing across **all tabs within the same Firefox container**. When a user opens Quick Tab 1 in Wikipedia Tab 1, then switches to a newly loaded Wikipedia Tab 2, **both Quick Tabs appear in Tab 2** even though Tab 2 never created them. This violates the v1.6.3 design goal of per-tab isolation and creates a confusing UX where Quick Tabs follow users across all tabs.

Three critical root causes enable this behavior:

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| 1. Wrong Tab ID on Init | Content Script | **CRITICAL** | Content script receives stale/cached tab ID from background |
| 2. originTabId Always NULL | Storage Hydration | **CRITICAL** | Cross-tab filtering completely bypassed - no tab ownership tracking |
| 3. Storage Write Blocked | VisibilityHandler | **HIGH** | Race condition prevents state persistence after hydration |

**Why bundled:** All three issues combine to break Quick Tab tab-isolation. Issue 1 causes Tab 2 to think it's Tab 1, Issue 2 removes the only safety check, and Issue 3 prevents corrective persistence. These must be fixed together to restore isolation.

<scope>
**Modify:**
- `src/content/content.js` → tab ID initialization flow
- `src/features/quick-tabs/QuickTabsManager.js` → hydration and originTabId assignment
- `src/features/quick-tabs/handlers/CreateHandler.js` → originTabId storage during creation
- `src/features/quick-tabs/coordinators/UICoordinator.js` → cross-tab filtering logic
- `src/features/quick-tabs/handlers/VisibilityHandler.js` → storage write currentTabId tracking

**Do NOT Modify:**
- `src/background/` → background scripts work correctly
- `src/features/quick-tabs/ui/QuickTabWindow.js` → window rendering is correct
</scope>

---

## Issue 1: Content Script Initializes With Wrong Tab ID

**Problem:** When user switches to Wikipedia Tab 2 (tabId=14), Tab 2's content script initializes with `currentTabId: 13` (Tab 1's ID). Content script operates as if it's Tab 1, hydrates all of Tab 1's Quick Tabs, and renders them.

**Root Cause:**

**File:** `src/content/content.js`  
**Location:** Tab ID fetch during QuickTabs initialization  
**Issue:** Content script requests current tab ID from background via `GET_CURRENT_TAB_ID` message, but background returns **stale/cached value** instead of actual active tab ID. Content scripts cannot directly call `browser.tabs.getCurrent()` (requires background permission), so they must rely on background to provide correct ID.

**Evidence from Logs (04:26:59.661):**
```
QuickTabsManager Using pre-fetched currentTabId 13
```

This occurs **in Tab 14** (Wikipedia Tab 2), but QuickTabsManager believes it's Tab 13. All subsequent operations use wrong tab identity.

**Why This Breaks Isolation:**
- Tab 14 thinks it's Tab 13
- Hydrates Tab 13's Quick Tabs from storage
- Renders them in Tab 14
- User sees Quick Tabs that belong to different tab

**Fix Required:**

Background's `GET_CURRENT_TAB_ID` handler must return **sender.tab.id** (actual requesting tab) instead of cached/global active tab ID. Content script initialization must verify received tab ID matches browser's active tab before proceeding with hydration.

Add validation logging: before hydration, log `receivedTabId`, `sender.tab.id`, and confirm they match. If mismatch detected, abort hydration and log critical error.

---

## Issue 2: originTabId is NULL - Cross-Tab Filtering Bypassed

**Problem:** All Quick Tabs hydrate with `originTabId: null`. UICoordinator's cross-tab filter checks `if (!originTabId) allow render`, which **always passes**. Quick Tabs render on every tab because filter has no tab ownership data.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/CreateHandler.js`  
**Location:** Quick Tab creation and storage serialization  
**Issue:** Quick Tabs created without `originTabId` field, or field is stripped during storage write. When Quick Tabs are hydrated from `browser.storage.local`, they have no tab ownership information.

**Evidence from Logs (04:26:59.733 and 04:26:59.738):**
```
CreateHandler Tab options id qt-14-1764995196356-y37red1hs634a, ... originTabId null
CreateHandler Tab options id qt-14-1764995197926-tp5f6togisnk, ... originTabId null
```

Both Quick Tabs have `originTabId: null` during hydration in Tab 14.

**Evidence from UICoordinator (04:26:59.737 and 04:26:59.741):**
```
UICoordinatorTab 13 No originTabId on Quick Tab, allowing render qt-14-1764995196356-y37red1hs634a
UICoordinatorTab 13 No originTabId on Quick Tab, allowing render qt-14-1764995197926-tp5f6togisnk
```

Filter logs "No originTabId" and **allows render** for both Quick Tabs, bypassing isolation.

**Why This Breaks Isolation:**
- Quick Tabs have no tab ownership metadata
- UICoordinator cannot determine "does this Quick Tab belong to current tab?"
- All Quick Tabs render everywhere
- v1.6.3's per-tab isolation design is non-functional

**Fix Required:**

During Quick Tab creation, assign `originTabId` field with value of `currentTabId` from creating tab. Ensure this field is included in storage persistence (verify `browser.storage.local.set()` payload contains `originTabId`).

During hydration, verify `originTabId` exists for all Quick Tabs loaded from storage. If missing (legacy tabs from v1.6.2), assign `originTabId` based on creation context or mark as "global" Quick Tab.

UICoordinator filter must check: `if (quickTab.originTabId !== currentTabId && quickTab.originTabId !== null) skip render`. Only render Quick Tabs that belong to current tab or are explicitly global.

Add logging: when Quick Tab is created, log `originTabId assignment: ${currentTabId}`. When Quick Tab is hydrated, log `originTabId from storage: ${originTabId}`. When filter evaluates, log `originTabId check: ${quickTab.originTabId} vs ${currentTabId} → render: ${shouldRender}`.

---

## Issue 3: Storage Write Blocked Due to NULL currentTabId

**Problem:** After Quick Tabs hydrate in Tab 14, system attempts to persist focus z-index updates. Both persistence attempts **BLOCKED** by StorageUtils safety check because `currentTabId` is `null` during write operation.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `debouncedPersist` → `StorageUtils.persistStateToStorage`  
**Issue:** VisibilityHandler tracks tab-specific state changes (minimize, restore, focus) but doesn't have access to `currentTabId` during storage write. StorageUtils blocks writes when tab ID is unknown to prevent data corruption.

**Evidence from Logs (04:26:59.942 and 04:26:59.943):**
```
StorageUtils Storage write BLOCKED - unknown tab ID initialization race?
VisibilityHandler Storage write BLOCKED txn-1764995219942-1-aej59r reason unknown tab ID - blocked for safety, currentTabId null
ERROR VisibilityHandler Storage persist failed operation timed out, storage API unavailable, or quota exceeded
```

Two separate storage writes fail with `currentTabId null`. Transaction IDs show these are focus-triggered persistence attempts.

**Why This Breaks Persistence:**
- Focus z-index changes don't save to storage
- Position/size updates likely also blocked (same code path)
- State diverges between memory and storage
- Reloading tab causes Quick Tabs to revert to stale state

**Fix Required:**

VisibilityHandler must receive and track `currentTabId` during initialization. When `debouncedPersist` calls `StorageUtils.persistStateToStorage`, pass `currentTabId` as parameter.

StorageUtils must accept optional `tabId` parameter in `persistStateToStorage()`. If provided, use it for write validation. If not provided but `initWritingTabId` has completed, use global tab ID. Only block if both are unavailable.

Add initialization sequence: ensure `currentTabId` is set in VisibilityHandler before any hydration occurs. Verify `initWritingTabId` completes before first storage write attempt.

Add logging: when VisibilityHandler initializes, log `VisibilityHandler initialized with currentTabId: ${currentTabId}`. When storage write is attempted, log `persistStateToStorage called with tabId: ${tabId}, globalTabId: ${this.currentTabId}`. When write is blocked, log exact reason and suggest fix.

---

## Additional Issues Discovered

### Issue 4: Background State Update Broadcast Storm

**Problem:** Between 04:26:56.252 and 04:26:56.494, background sends **150+ identical state update broadcasts** to sidebar/popup in rapid succession.

**Evidence from Logs:**
```
DEBUG Background Sent state update to sidebarpopup (x150+)
```

Pattern shows these fire continuously over 242ms window, suggesting infinite loop or recursion in state change notification system.

**Root Cause:** Unknown - logs don't show what triggers broadcasts. Likely related to deletion event processing (occurs immediately after Quick Tab deletion storm).

**Impact:** Performance degradation, unnecessary CPU usage, potential memory leak if broadcasts accumulate.

**Fix Required:** Add logging before state update broadcast to capture trigger source. Implement broadcast deduplication - only send if state hash actually changed. Add circuit breaker: if more than 10 broadcasts occur within 100ms, log error and stop broadcasting.

---

### Issue 5: Orphaned Window Recovery During Fresh Page Load

**Problem:** Tab 14 freshly loads, content script initializes, but UICoordinator detects "orphaned windows" (DOM elements exist but not tracked in Map).

**Evidence from Logs (04:26:59.738 and 04:26:59.741):**
```
WARN UICoordinator Orphaned window detected id qt-14-1764995196356-y37red1hs634a, inMap false, inDOM true
WARN UICoordinator Orphaned window detected id qt-14-1764995197926-tp5f6togisnk, inMap false, inDOM true
```

**Root Cause:** Quick Tabs created and added to DOM via `CreateHandler.createQuickTab()` → `QuickTabWindow.render()`, but UICoordinator's internal Map doesn't track them until `stateadded` event fires. There's a timing gap where DOM elements exist but Map doesn't know about them.

**Why This Happens:**
1. CreateHandler creates Quick Tab, renders to DOM
2. CreateHandler emits `windowcreated` event
3. UICoordinator receives `stateadded` event (separate event bus)
4. UICoordinator queries DOM for element (finds it)
5. UICoordinator checks Map (not there yet)
6. Logs "orphaned window" warning

**Impact:** Confusing logs, but system recovers gracefully. However, indicates architectural issue where DOM state precedes Map state, creating race condition window.

**Fix Required:** Ensure Map is updated **before** DOM rendering, or ensure `stateadded` event fires synchronously before `windowcreated`. Alternatively, suppress "orphaned window" warning during hydration phase (expected behavior).

---

## Missing Logging Identified

### Critical Logging Gaps:

1. **No logging for originTabId assignment during Quick Tab creation**
   - Cannot verify when/how originTabId is set
   - Cannot diagnose if it's being set then stripped vs never set

2. **No logging for originTabId extraction during storage hydration**
   - Cannot confirm if storage contains originTabId field
   - Cannot see if hydration code reads it correctly

3. **No logging for cross-tab filter decision in UICoordinator**
   - Cannot observe filter logic evaluation
   - Cannot debug "why did this Quick Tab render when it shouldn't?"

4. **No logging for currentTabId resolution in content script initialization**
   - Cannot verify sender.tab.id vs received ID
   - Cannot detect stale ID before it causes problems

5. **No logging for VisibilityHandler currentTabId initialization**
   - Cannot confirm VisibilityHandler has valid tab ID
   - Cannot diagnose why storage writes fail with null ID

6. **No logging for state update broadcast trigger source**
   - Cannot identify what causes broadcast storm
   - Cannot debug why 150+ broadcasts occur

7. **Minimal logging for GET_CURRENT_TAB_ID message handler**
   - Background returns tab ID but doesn't log source
   - Cannot verify if using sender.tab.id vs cached value

---

<acceptancecriteria>
**Issue 1 - Tab ID Initialization:**
- Content script receives correct tab ID matching browser's active tab
- Hydration uses verified tab ID, not cached/stale value
- Logs show `currentTabId verified: received=${receivedId}, actual=${sender.tab.id}`

**Issue 2 - originTabId Filtering:**
- Quick Tabs created with `originTabId` field set to creating tab's ID
- Quick Tabs hydrated from storage preserve `originTabId` value
- UICoordinator only renders Quick Tabs where `originTabId === currentTabId` or `originTabId === null` (legacy/global)
- Logs show `originTabId filter: ${quickTab.id} originTabId=${originTabId} currentTabId=${currentTabId} → render=${shouldRender}`

**Issue 3 - Storage Write Race:**
- VisibilityHandler initialized with valid `currentTabId` before any operations
- Storage writes include `tabId` parameter, never blocked with "unknown tab ID"
- Logs show `persistStateToStorage called with tabId: ${tabId}` and `✓ Storage write successful`

**Issue 4 - Broadcast Storm:**
- No more than 10 state update broadcasts per 100ms window
- Logs show broadcast trigger source before each broadcast
- Circuit breaker triggers if broadcast rate exceeds limit

**Issue 5 - Orphaned Window:**
- No orphaned window warnings during hydration phase
- Map updated synchronously with DOM rendering, or warnings suppressed

**All Issues:**
- Quick Tabs isolated per tab - Tab 1's Quick Tabs do NOT appear in Tab 2
- Manual test: Create QT in Tab 1, switch to Tab 2 (fresh load), verify QT absent
- All existing tests pass
- No console errors or warnings
</acceptancecriteria>

---

<details>
<summary>Detailed Log Analysis - Issue 1</summary>

**Timeline of Wrong Tab ID Bug:**

```
04:26:56.252 - User switches from Tab 13 to Tab 14
  Background Tab activated 14

04:26:59.602 - Tab 14 content script begins initialization
  Content script loaded, starting initialization

04:26:59.643 - Background receives GET_CURRENT_TAB_ID message
  QuickTabHandler GET_CURRENT_TAB_ID returning 13 from sender.tab

04:26:59.661 - Tab 14 receives WRONG tab ID (13 instead of 14)
  Content Got current tab ID from background 13
  QuickTabsManager Using pre-fetched currentTabId 13

04:26:59.732 - Hydration occurs with wrong tab identity
  Reading state from storage.local key quick_tabs_state_v2
  Found 2 Quick Tabs in storage to hydrate
```

**Critical Observation:** Background's log says "returning 13 from sender.tab" but Tab 14 is the sender. Either:
- Background is returning cached active tab (13) instead of sender.tab.id (14)
- Or background is correctly returning sender.tab.id but sender object is stale
- Or message routing is delivering response to wrong tab

**Resolution Path:** Add logging in background GET_CURRENT_TAB_ID handler:
```
Background GET_CURRENT_TAB_ID: sender.tab.id=${sender.tab.id}, sender.tab.active=${sender.tab.active}
```

Compare sender.tab.id with browser.tabs.getCurrent() result to detect mismatch.

</details>

<details>
<summary>Detailed Log Analysis - Issue 2</summary>

**Evidence of NULL originTabId:**

```
04:26:59.733 - First Quick Tab creation with NULL originTabId
  CreateHandler Tab options id qt-14-1764995196356-y37red1hs634a, ...
    cookieStoreId firefox-container-9,
    zIndex 1000001,
    left 835, top 635, width 960, height 540,
    title Shukusei!! Loli Kami Requiem,
    minimized false,
    soloedOnTabs [],
    mutedOnTabs [],
    showDebugId true,
    originTabId null  ← PROBLEM

04:26:59.738 - Second Quick Tab creation with NULL originTabId
  CreateHandler Tab options id qt-14-1764995197926-tp5f6togisnk, ...
    originTabId null  ← PROBLEM

04:26:59.737 - UICoordinator allows render due to NULL check
  UICoordinatorTab 13 No originTabId on Quick Tab, allowing render qt-14-1764995196356-y37red1hs634a

04:26:59.741 - UICoordinator allows render again
  UICoordinatorTab 13 No originTabId on Quick Tab, allowing render qt-14-1764995197926-tp5f6togisnk
```

**Critical Observation:** `originTabId` is explicitly `null` in CreateHandler options. This suggests either:
- Storage doesn't contain originTabId field (legacy tabs from v1.6.2)
- Hydration code doesn't extract originTabId from storage
- CreateHandler defaults originTabId to null when field is missing

**Resolution Path:** Check storage.local structure - do saved Quick Tabs have originTabId field? If missing, migration needed. If present, verify hydration extracts it correctly.

</details>

<details>
<summary>Detailed Log Analysis - Issue 3</summary>

**Storage Write Failure Sequence:**

```
04:26:59.942 - First persistence attempt (focus operation on QT 1)
  VisibilityHandler Timer callback STARTED source UI
    id qt-14-1764995196356-y37red1hs634a,
    operation focus
  VisibilityHandler Building state for storage persist...
  VisibilityHandler Persisting 2 tabs 0 minimized
  VisibilityHandler Storage write STARTED txn-1764995219942-1-aej59r
  
  ← BLOCK OCCURS HERE
  
  StorageUtils Storage write BLOCKED - unknown tab ID initialization race?
    tabCount 2, forceEmpty false,
    suggestion Pass tabId parameter to persistStateToStorage or wait for initWritingTabId to complete
    
  VisibilityHandler Storage write BLOCKED txn-1764995219942-1-aej59r
    reason unknown tab ID - blocked for safety,
    currentTabId null,  ← ROOT CAUSE
    tabCount 2, forceEmpty false
    
  ERROR VisibilityHandler Storage persist failed operation timed out, storage API unavailable, or quota exceeded

04:26:59.943 - Second persistence attempt (focus operation on QT 2)
  [Identical failure pattern with currentTabId null]
```

**Critical Observation:** `currentTabId null` during storage write means VisibilityHandler doesn't have tab context. StorageUtils safety check correctly blocks write (writing without tab ID could corrupt multi-tab state).

**Resolution Path:** VisibilityHandler must receive currentTabId during construction and pass it to persistStateToStorage(). Verify initialization order: currentTabId must be set before any operations trigger persistence.

</details>

---

**Priority:** CRITICAL  
**Target:** Single coordinated PR fixing all 3 core issues  
**Estimated Complexity:** HIGH (requires initialization flow refactor + storage schema migration)

