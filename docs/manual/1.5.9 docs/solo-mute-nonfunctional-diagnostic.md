# Solo/Mute Quick Tabs Non-Functional Behavior - Diagnostic Report

## Executive Summary

The solo and mute buttons in Quick Tabs (v1.5.9.13) are completely non-functional. The buttons appear in the UI but do not change state when clicked, and do not trigger any visibility changes to Quick Tabs across browser tabs. This report identifies **three critical root causes** preventing the feature from working and provides detailed remediation steps.

---

## Observed Behavior

### User Actions Attempted

1. **Clicked Solo button (🎯/⭕)** on a Quick Tab in Tab 1
2. **Clicked Mute button (🔊/🔇)** on a Quick Tab in Tab 1

### Expected Behavior

**Solo:**
- Button icon changes from ⭕ to 🎯
- Button background changes to gray (#444)
- Quick Tab disappears from Tab 2, Tab 3, and all other tabs
- Quick Tab remains visible only on Tab 1

**Mute:**
- Button icon changes from 🔊 to 🔇
- Button background changes to red (#c44)
- Quick Tab disappears from Tab 1 only
- Quick Tab remains visible on Tab 2, Tab 3, and all other tabs

### Actual Behavior

- **Buttons do not change appearance** (icon stays the same, background stays transparent)
- **No console logs generated** from button click handlers
- **No Quick Tabs hide or show** on any tab
- **Quick Tab Manager panel shows no indicator changes** (no 🎯 or 🔇 icons)

---

## Log Analysis Findings

### Extension Logs (v1.5.9.13_2025-11-18T03-04-42.txt)

**Critical Finding: Tab ID Detection Failed**

```
[2025-11-18T03:04:32.232Z] [WARN ] [QuickTabsManager] Failed to get tab ID from background
```

This warning occurs during `detectCurrentTabId()` initialization and indicates that the background script's `GET_CURRENT_TAB_ID` handler is **not returning a valid tab ID**.

**Result:** `quickTabsManager.currentTabId` remains `null` throughout the entire session.

**Consequence:** All solo/mute operations fail silently because:
- `isCurrentTabSoloed()` returns `false` (checks `window.quickTabsManager.currentTabId`)
- `isCurrentTabMuted()` returns `false` (checks `window.quickTabsManager.currentTabId`)
- `toggleSolo()` exits early with console warning
- `toggleMute()` exits early with console warning

**Evidence from Logs:**

```
[2025-11-18T03:04:32.329Z] [WARN ] [QuickTabsManager] No current tab ID, cannot filter visibility
[2025-11-18T03:04:32.329Z] [WARN ] [QuickTabsManager] No current tab ID, cannot filter visibility
[2025-11-18T03:04:32.329Z] [WARN ] [QuickTabsManager] No current tab ID, cannot filter visibility
```

These warnings appear during `syncFromStorage()` where `shouldQuickTabBeVisible()` is called. Because `currentTabId` is `null`, the visibility filter cannot function.

**No button click logs:** The logs contain **no messages** from `toggleSolo()` or `toggleMute()` methods, confirming that the early exit warnings are never logged (buttons are not triggering handlers).

---

## Root Cause Analysis

### Root Cause #1: Missing Global Window Reference to QuickTabsManager

**Location:** `src/features/quick-tabs/index.js` (QuickTabsManager initialization)

**Problem:** The `QuickTabWindow` class attempts to access `window.quickTabsManager` to get the current tab ID:

```javascript
// From window.js
isCurrentTabSoloed() {
  return (
    this.soloedOnTabs &&
    this.soloedOnTabs.length > 0 &&
    window.quickTabsManager &&          // ← ACCESSING GLOBAL
    window.quickTabsManager.currentTabId &&
    this.soloedOnTabs.includes(window.quickTabsManager.currentTabId)
  );
}
```

However, the QuickTabsManager instance is **never assigned to `window.quickTabsManager`**. The singleton is exported from the module but not globally exposed.

**Current Code (index.js):**

```javascript
// Create singleton instance
const quickTabsManager = new QuickTabsManager();

export async function initQuickTabs(eventBus, Events) {
  console.log('[QuickTabs] Initializing Quick Tabs feature module...');
  await quickTabsManager.init(eventBus, Events);
  console.log('[QuickTabs] Quick Tabs feature module initialized');
  return quickTabsManager;
}

export { quickTabsManager };
```

**Missing:** No assignment to `window.quickTabsManager`.

**Result:** `window.quickTabsManager` is always `undefined`, causing:
- `isCurrentTabSoloed()` returns `false`
- `isCurrentTabMuted()` returns `false`
- `toggleSolo()` exits with "Cannot toggle solo - no current tab ID"
- `toggleMute()` exits with "Cannot toggle mute - no current tab ID"

**Evidence:** The warning "Failed to get tab ID from background" confirms that even if the tab ID were successfully retrieved, it would be stored in `quickTabsManager.currentTabId` (module scope), but the buttons access `window.quickTabsManager.currentTabId` (global scope), which doesn't exist.

---

### Root Cause #2: Background Script Handler Returns Null Tab ID

**Location:** `background.js` → `GET_CURRENT_TAB_ID` message handler

**Problem:** The `GET_CURRENT_TAB_ID` handler is implemented but returns `{ tabId: null }` instead of a valid tab ID.

**Current Implementation:**

```javascript
// v1.5.9.13 - Handle tab ID requests from content scripts
if (message.action === 'GET_CURRENT_TAB_ID') {
  // sender.tab is automatically provided by Firefox for content script messages
  if (sender.tab && sender.tab.id) {
    sendResponse({ tabId: sender.tab.id });
  } else {
    sendResponse({ tabId: null });  // ← RETURNS NULL
  }
  return true;
}
```

**Why `sender.tab` is Null:**

The comment states "`sender.tab` is automatically provided by Firefox for content script messages", but this is **only true for messages sent from content scripts that are currently attached to a tab**.

**The Issue:** During initialization, the content script sends the `GET_CURRENT_TAB_ID` message **before the content script is fully registered** with the tab context, OR the message is sent from a context where `sender.tab` is not populated (e.g., iframe, detached script).

**Evidence from Firefox WebExtensions API:**

From MDN documentation on `runtime.onMessage`:
> "sender.tab: This property will only be present when the connection was opened from a tab (including content scripts)"

However, during eager initialization, the timing of when `sender.tab` becomes available can vary. If the message is sent too early or from an incorrect context, `sender.tab` will be `undefined`.

**Additional Investigation Needed:** The logs show the warning "Failed to get tab ID from background", which means the response was `{ tabId: null }`, but there's **no background log showing the GET_CURRENT_TAB_ID handler being called**. This suggests:

1. The message is being sent from content script
2. The background handler is executing
3. But `sender.tab` is `undefined` or `sender.tab.id` is `undefined`

**Possible Causes:**
- Content script initialized in a context without a tab (e.g., sidebar, popup)
- Race condition where `sender.tab` is not yet populated
- Message sent from wrong execution context

---

### Root Cause #3: Button Event Handlers Not Wired Correctly

**Location:** `src/features/quick-tabs/window.js` → `createTitlebar()` method

**Problem:** The solo and mute buttons are created with `this.createButton()`, which sets up a click handler that calls `onClick()`. However, there's a **potential issue with the button reference passing**.

**Current Code:**

```javascript
// v1.5.9.13 - Solo button (replaces pin button)
const soloBtn = this.createButton(
  this.isCurrentTabSoloed() ? '🎯' : '⭕',
  () => this.toggleSolo(soloBtn)  // ← PASSING soloBtn TO HANDLER
);
soloBtn.title = this.isCurrentTabSoloed()
  ? 'Un-solo (show on all tabs)'
  : 'Solo (show only on this tab)';
soloBtn.style.background = this.isCurrentTabSoloed() ? '#444' : 'transparent';
controls.appendChild(soloBtn);
this.soloButton = soloBtn;

// v1.5.9.13 - Mute button
const muteBtn = this.createButton(
  this.isCurrentTabMuted() ? '🔇' : '🔊',
  () => this.toggleMute(muteBtn)  // ← PASSING muteBtn TO HANDLER
);
muteBtn.title = this.isCurrentTabMuted()
  ? 'Unmute (show on this tab)'
  : 'Mute (hide on this tab)';
muteBtn.style.background = this.isCurrentTabMuted() ? '#c44' : 'transparent';
controls.appendChild(muteBtn);
this.muteButton = muteBtn;
```

**Analysis of `createButton()`:**

```javascript
createButton(text, onClick) {
  const button = createElement('button', { /* styles */ }, text);

  button.addEventListener('mouseenter', () => { /* hover */ });
  button.addEventListener('mouseleave', () => { /* unhover */ });
  
  button.addEventListener('click', e => {
    e.stopPropagation();
    onClick();  // ← CALLS onClick WITHOUT ARGUMENTS
  });

  return button;
}
```

**Issue Identified:** The `onClick` callback is invoked **without passing the button element as an argument**. However, the solo/mute toggle methods **expect the button element** as their first parameter:

```javascript
toggleSolo(soloBtn) {  // ← EXPECTS soloBtn PARAMETER
  if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
    console.warn('[QuickTabWindow] Cannot toggle solo - no current tab ID');
    return;
  }
  // ...
  soloBtn.textContent = '🎯';  // ← USES soloBtn PARAMETER
  soloBtn.style.background = '#444';
}
```

**Critical Realization:** The `onClick` arrow function `() => this.toggleSolo(soloBtn)` **DOES** pass `soloBtn` as an argument. This is correct.

**However, the real issue is:**
- `isCurrentTabSoloed()` checks `window.quickTabsManager.currentTabId`
- `window.quickTabsManager` is **undefined** (Root Cause #1)
- Therefore, `isCurrentTabSoloed()` returns `false`
- Button is initialized with wrong icon (⭕ instead of potentially 🎯)

**But the button click should still trigger `toggleSolo()`**, which should log the warning:
```javascript
console.warn('[QuickTabWindow] Cannot toggle solo - no current tab ID');
```

**Why no logs appear:**

Since there are **no warning logs** from `toggleSolo()` or `toggleMute()` in the extension logs, this suggests that:

1. The button click handlers are not firing at all, OR
2. The early exit is happening so fast that the console warning is suppressed, OR
3. The buttons are not receiving click events (e.g., event propagation issue)

**Additional Investigation:** Check if `e.stopPropagation()` in `createButton()` is preventing the click from reaching the `onClick` handler. However, the code shows `onClick()` is called **after** `stopPropagation()`, so this should work correctly.

**Conclusion:** The button handlers ARE wired correctly, but they exit early due to Root Cause #1 (no global window reference) and Root Cause #2 (null tab ID).

---

## Secondary Issues

### Issue #4: Storage Schema Still Uses `pinnedToUrl` in Emergency Save

**Location:** `src/features/quick-tabs/index.js` → `saveCurrentStateToBackground()` method

**Problem:** The emergency save handler still references the old `pinnedToUrl` property instead of the new `soloedOnTabs` and `mutedOnTabs` arrays.

**Current Code:**

```javascript
saveCurrentStateToBackground() {
  if (this.tabs.size === 0) return;

  const saveId = this.generateSaveId();
  const tabsArray = Array.from(this.tabs.values()).map(tabWindow => ({
    id: tabWindow.id || tabWindow.element?.id,
    url: tabWindow.url || tabWindow.iframe?.src,
    left: parseInt(tabWindow.element?.style.left) || 100,
    top: parseInt(tabWindow.element?.style.top) || 100,
    width: parseInt(tabWindow.element?.style.width) || 800,
    height: parseInt(tabWindow.element?.style.height) || 600,
    title: tabWindow.title || 'Quick Tab',
    cookieStoreId: tabWindow.cookieStoreId || this.cookieStoreId || 'firefox-default',
    minimized: tabWindow.minimized || false,
    pinnedToUrl: tabWindow.pinnedToUrl || null  // ← OLD PROPERTY
  }));
  // ...
}
```

**Impact:** Emergency saves (triggered on tab switch or page unload) will **not persist solo/mute state**, causing Quick Tabs to lose their visibility settings.

**Fix Required:** Replace `pinnedToUrl` with:

```javascript
soloedOnTabs: tabWindow.soloedOnTabs || [],
mutedOnTabs: tabWindow.mutedOnTabs || []
```

---

### Issue #5: Broadcast Messages Still Use `pinnedToUrl` in CREATE Action

**Location:** `src/features/quick-tabs/index.js` → `createQuickTab()` method

**Problem:** The broadcast CREATE message still includes the old `pinnedToUrl` property instead of solo/mute arrays.

**Current Code:**

```javascript
// v1.5.8.13 - Broadcast creation to other tabs
this.broadcast('CREATE', {
  id,
  url: options.url,
  left: options.left || 100,
  top: options.top || 100,
  width: options.width || 800,
  height: options.height || 600,
  title: options.title || 'Quick Tab',
  cookieStoreId: cookieStoreId,
  minimized: options.minimized || false,
  pinnedToUrl: options.pinnedToUrl || null  // ← OLD PROPERTY
});
```

**Impact:** When Quick Tabs are created, the broadcast to other tabs does **not include solo/mute state**, preventing cross-tab visibility synchronization.

**Fix Required:** Replace `pinnedToUrl` with:

```javascript
soloedOnTabs: options.soloedOnTabs || [],
mutedOnTabs: options.mutedOnTabs || []
```

---

## Detailed Remediation Steps

### Fix #1: Expose QuickTabsManager Globally

**File:** `src/features/quick-tabs/index.js`

**Problem:** `window.quickTabsManager` is undefined

**Solution:** Assign the singleton instance to the global window object after initialization.

**Required Changes:**

1. **Add global assignment in `init()` method:**

```javascript
async init(eventBus, Events) {
  if (this.initialized) {
    console.log('[QuickTabsManager] Already initialized, skipping');
    return;
  }

  this.eventBus = eventBus;
  this.Events = Events;

  console.log('[QuickTabsManager] Initializing with eager loading...');

  // ... existing initialization code ...

  // v1.5.9.13 - Expose manager globally for QuickTabWindow button access
  if (typeof window !== 'undefined') {
    window.quickTabsManager = this;
    console.log('[QuickTabsManager] Exposed globally as window.quickTabsManager');
  }

  this.initialized = true;
  console.log('[QuickTabsManager] Initialized successfully with eager loading');
}
```

**Placement:** Add the global assignment **after** `detectCurrentTabId()` completes and **before** setting `this.initialized = true`.

**Rationale:** By exposing the manager globally, the `QuickTabWindow` button handlers can access `window.quickTabsManager.currentTabId` reliably.

---

### Fix #2: Improve Tab ID Detection Reliability

**File:** `background.js`

**Problem:** `sender.tab` is undefined during initialization, causing tab ID detection to fail

**Solution:** Implement a more robust tab ID detection strategy that queries the tabs API directly.

**Required Changes:**

**Option A: Enhanced Background Handler with Fallback**

```javascript
// v1.5.9.13 - Handle tab ID requests from content scripts
if (message.action === 'GET_CURRENT_TAB_ID') {
  // FIRST: Try sender.tab (standard approach)
  if (sender.tab && sender.tab.id) {
    console.log(`[Background] GET_CURRENT_TAB_ID: Returning tab ID ${sender.tab.id} from sender.tab`);
    sendResponse({ tabId: sender.tab.id });
    return true;
  }

  // FALLBACK: Query active tab in current window
  // This handles cases where sender.tab is not populated
  browser.tabs.query({ active: true, currentWindow: true })
    .then(tabs => {
      if (tabs && tabs.length > 0 && tabs[0].id) {
        console.log(`[Background] GET_CURRENT_TAB_ID: Returning tab ID ${tabs[0].id} from tabs.query`);
        sendResponse({ tabId: tabs[0].id });
      } else {
        console.warn('[Background] GET_CURRENT_TAB_ID: Could not determine tab ID');
        sendResponse({ tabId: null });
      }
    })
    .catch(err => {
      console.error('[Background] GET_CURRENT_TAB_ID: Error querying tabs:', err);
      sendResponse({ tabId: null });
    });

  return true; // Keep channel open for async response
}
```

**Rationale:** This fallback ensures tab ID detection works even if `sender.tab` is not populated during initialization.

**Option B: Alternative Content Script Approach (Preferred)**

Instead of relying on background script, use `browser.tabs.getCurrent()` directly in the content script (if available), or pass tab ID during content script injection.

**However:** `browser.tabs.getCurrent()` does **not work in content scripts** (only in extension pages). Therefore, the background script approach is necessary.

**Recommendation:** Use Option A (enhanced background handler with fallback).

---

### Fix #3: Update Emergency Save Schema

**File:** `src/features/quick-tabs/index.js`

**Problem:** `saveCurrentStateToBackground()` still uses `pinnedToUrl`

**Solution:** Replace the old property with solo/mute arrays.

**Required Changes:**

```javascript
saveCurrentStateToBackground() {
  if (this.tabs.size === 0) return;

  const saveId = this.generateSaveId();
  const tabsArray = Array.from(this.tabs.values()).map(tabWindow => ({
    id: tabWindow.id || tabWindow.element?.id,
    url: tabWindow.url || tabWindow.iframe?.src,
    left: parseInt(tabWindow.element?.style.left) || 100,
    top: parseInt(tabWindow.element?.style.top) || 100,
    width: parseInt(tabWindow.element?.style.width) || 800,
    height: parseInt(tabWindow.element?.style.height) || 600,
    title: tabWindow.title || 'Quick Tab',
    cookieStoreId: tabWindow.cookieStoreId || this.cookieStoreId || 'firefox-default',
    minimized: tabWindow.minimized || false,
    soloedOnTabs: tabWindow.soloedOnTabs || [],  // ← FIX: Use solo array
    mutedOnTabs: tabWindow.mutedOnTabs || []     // ← FIX: Use mute array
  }));

  // ... rest of method unchanged ...
}
```

**Location:** Line ~244 in `src/features/quick-tabs/index.js` (approximately)

---

### Fix #4: Update Broadcast CREATE Message Schema

**File:** `src/features/quick-tabs/index.js`

**Problem:** `createQuickTab()` broadcast still uses `pinnedToUrl`

**Solution:** Replace the old property with solo/mute arrays.

**Required Changes:**

```javascript
createQuickTab(options) {
  // ... existing code ...

  // v1.5.8.13 - Broadcast creation to other tabs
  // v1.5.9.12 - Container-specific broadcast (channel already filtered)
  this.broadcast('CREATE', {
    id,
    url: options.url,
    left: options.left || 100,
    top: options.top || 100,
    width: options.width || 800,
    height: options.height || 600,
    title: options.title || 'Quick Tab',
    cookieStoreId: cookieStoreId,
    minimized: options.minimized || false,
    soloedOnTabs: options.soloedOnTabs || [],  // ← FIX: Use solo array
    mutedOnTabs: options.mutedOnTabs || []     // ← FIX: Use mute array
  });

  // ... rest of method unchanged ...
}
```

**Location:** Line ~458 in `src/features/quick-tabs/index.js` (approximately)

---

### Fix #5: Add Defensive Logging to Button Handlers

**File:** `src/features/quick-tabs/window.js`

**Problem:** No logs confirm whether button click handlers are firing

**Solution:** Add console logs at the start of `toggleSolo()` and `toggleMute()` to confirm execution.

**Required Changes:**

```javascript
toggleSolo(soloBtn) {
  console.log('[QuickTabWindow] toggleSolo called for:', this.id);
  
  if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
    console.warn('[QuickTabWindow] Cannot toggle solo - no current tab ID');
    console.warn('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
    console.warn('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);
    return;
  }

  // ... rest of method unchanged ...
}

toggleMute(muteBtn) {
  console.log('[QuickTabWindow] toggleMute called for:', this.id);
  
  if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
    console.warn('[QuickTabWindow] Cannot toggle mute - no current tab ID');
    console.warn('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
    console.warn('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);
    return;
  }

  // ... rest of method unchanged ...
}
```

**Rationale:** These logs will help confirm whether:
- Button click handlers are firing
- `window.quickTabsManager` is defined
- `currentTabId` is populated

---

## Implementation Priority

### Critical (Must Fix for Basic Functionality)

1. **Fix #1: Expose QuickTabsManager Globally** (Root Cause #1)
   - Without this, buttons cannot access tab ID
   - Blocks all solo/mute functionality

2. **Fix #2: Improve Tab ID Detection** (Root Cause #2)
   - Without this, tab ID remains null
   - Blocks visibility filtering

### High Priority (State Persistence)

3. **Fix #3: Update Emergency Save Schema**
   - Without this, solo/mute state lost on tab switch
   - Causes inconsistent behavior

4. **Fix #4: Update Broadcast CREATE Schema**
   - Without this, cross-tab sync fails
   - Breaks real-time visibility updates

### Medium Priority (Debugging)

5. **Fix #5: Add Defensive Logging**
   - Helps diagnose remaining issues
   - Not required for functionality

---

## Testing Checklist

After implementing all fixes, verify the following:

### Solo Functionality

- [ ] Click solo button (⭕) on Tab 1 → icon changes to 🎯, background changes to gray
- [ ] Quick Tab disappears from Tab 2 and Tab 3
- [ ] Quick Tab remains visible on Tab 1
- [ ] Click solo button again (🎯) → icon changes to ⭕, background clears
- [ ] Quick Tab reappears on Tab 2 and Tab 3
- [ ] Console logs show: `[QuickTabWindow] toggleSolo called for: qt-xxx`
- [ ] Console logs show: `[QuickTabsManager] Toggling solo for qt-xxx: [1234]`
- [ ] Background logs show: `[Background] Received solo update: qt-xxx soloedOnTabs: [1234]`

### Mute Functionality

- [ ] Click mute button (🔊) on Tab 1 → icon changes to 🔇, background changes to red
- [ ] Quick Tab disappears from Tab 1 only
- [ ] Quick Tab remains visible on Tab 2 and Tab 3
- [ ] Click mute button again (🔇) → icon changes to 🔊, background clears
- [ ] Quick Tab reappears on Tab 1
- [ ] Console logs show: `[QuickTabWindow] toggleMute called for: qt-xxx`
- [ ] Console logs show: `[QuickTabsManager] Toggling mute for qt-xxx: [1234]`
- [ ] Background logs show: `[Background] Received mute update: qt-xxx mutedOnTabs: [1234]`

### Tab ID Detection

- [ ] Console logs show: `[QuickTabsManager] Current tab ID: 1234` (valid number, not null)
- [ ] No warning: `[QuickTabsManager] Failed to get tab ID from background`
- [ ] No warning: `[QuickTabsManager] No current tab ID, cannot filter visibility`
- [ ] Background logs show: `[Background] GET_CURRENT_TAB_ID: Returning tab ID 1234 from sender.tab` OR `from tabs.query`

### Global Window Reference

- [ ] Console logs show: `[QuickTabsManager] Exposed globally as window.quickTabsManager`
- [ ] In browser console, typing `window.quickTabsManager` returns object (not undefined)
- [ ] In browser console, typing `window.quickTabsManager.currentTabId` returns number (not null)

### Cross-Tab Sync

- [ ] Solo on Tab 1 → Tab 2 Quick Tab disappears within 100ms
- [ ] Mute on Tab 1 → Tab 2 Quick Tab remains visible
- [ ] Storage updates include `soloedOnTabs` and `mutedOnTabs` arrays (check browser.storage.sync)

### State Persistence

- [ ] Solo on Tab 1 → switch to Tab 2 → switch back to Tab 1 → Quick Tab still soloed
- [ ] Mute on Tab 1 → refresh Tab 1 → Quick Tab still muted
- [ ] Close Tab 1 → Tab ID removed from solo/mute arrays (check background logs)

---

## Additional Observations

### Migration from Pin to Solo/Mute

The migration function in `background.js` correctly removes the old `pinnedToUrl` property:

```javascript
async function migrateQuickTabState() {
  // ... migration logic ...
  delete quickTab.pinnedToUrl;
  // ... save migrated state ...
}
```

However, two critical issues remain:
1. Emergency save still uses `pinnedToUrl` (Fix #3 addresses this)
2. Broadcast CREATE still uses `pinnedToUrl` (Fix #4 addresses this)

These inconsistencies will cause **state corruption** where old and new formats are mixed, leading to unpredictable behavior.

### Quick Tabs Manager Panel (Not Tested)

The user mentioned they're "not sure" if the panel shows solo/mute indicators because the buttons don't work. However, the panel code (`src/features/quick-tabs/panel.js`) was not provided in the repository files fetched.

**Recommendation:** After fixing the button functionality, verify that the panel displays:
- 🎯 indicator for soloed Quick Tabs
- 🔇 indicator for muted Quick Tabs
- Correct badge text (e.g., `[Solo: Tabs 1,2]`)

If the panel does not update, additional changes may be needed in `panel.js` to handle solo/mute state rendering.

---

## Conclusion

The solo/mute feature is completely non-functional due to **three critical architectural issues**:

1. **Missing global window reference** - QuickTabWindow cannot access QuickTabsManager
2. **Failed tab ID detection** - Background handler returns null instead of valid tab ID
3. **Schema inconsistencies** - Emergency save and broadcasts still use old pin property

All five fixes must be implemented to restore functionality. The priority order ensures basic operation is achieved first (Fixes #1 and #2), followed by state persistence (Fixes #3 and #4), and finally debugging improvements (Fix #5).

The root causes are architectural rather than logic errors - the solo/mute logic itself is correct, but it cannot execute due to missing infrastructure.
