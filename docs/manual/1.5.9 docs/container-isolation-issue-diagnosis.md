# Container Tab Isolation Issue - Diagnostic Report

## Issue Summary

**Problem:** Quick Tabs created in Firefox Container 1 are appearing in Firefox Container 2 when switching tabs, despite container integration being implemented in v1.5.9.12.

**Observed Behavior:** After creating Quick Tabs in the default container (`firefox-default`), switching to another tab causes the Quick Tabs to appear in that tab as well, regardless of which container the second tab is in.

**Expected Behavior:** Quick Tabs should remain isolated within their originating container. Quick Tabs from Container 1 should not appear when switching to tabs in Container 2.

---

## Log Analysis

### Key Evidence from Logs

**All Quick Tabs Show Same Container ID:**

```
"cookieStoreId": "firefox-default"
```

Every Quick Tab creation event in the logs shows `cookieStoreId: "firefox-default"`. This indicates:

1. The extension is detecting the container context
2. All Quick Tabs in the test were created in the default container
3. The user likely did not actually switch between different containers during testing

**Container-Specific BroadcastChannel Created:**

```
[QuickTabsManager] BroadcastChannel created: quick-tabs-sync-firefox-default
```

The extension successfully creates a container-specific BroadcastChannel during initialization, which is correct behavior for container isolation.

**Container Filtering in Storage Sync:**

```
[QuickTabsManager] Syncing from storage state (container: firefox-default)...
[QuickTabsManager] Syncing 2 tabs from container firefox-default
```

The `syncFromStorage()` method correctly filters by container when processing storage changes.

**No Container Switch Detected:**
The logs show no evidence of switching to a different container. All operations occur within `firefox-default`.

---

## Root Cause Analysis

### Issue 1: Container Detection Not Working in Non-Default Containers

**Location:** `src/features/quick-tabs/index.js` - `detectContainerContext()`

**The Problem:**

The container detection logic uses `browser.tabs.query({ active: true, currentWindow: true })`, which is correct. However, there's a critical timing issue:

**Content scripts load asynchronously across tabs.** When a user switches from Tab A (Container 1) to Tab B (Container 2):

1. Tab A's content script has `cookieStoreId = "firefox-container-1"`
2. Tab B's content script may not be initialized yet
3. When Tab B loads, it calls `detectContainerContext()`
4. `tabs.query({ active: true, currentWindow: true })` executes
5. **BUT**: By the time the query resolves, the user may have switched tabs again
6. The query returns Tab A (no longer active) instead of Tab B
7. Tab B incorrectly detects `cookieStoreId = "firefox-container-1"`

**Why This Causes Cross-Container Visibility:**

- Tab B thinks it's in Container 1
- Tab B listens to `quick-tabs-sync-firefox-container-1` BroadcastChannel
- Quick Tabs from Container 1 are broadcasted on that channel
- Tab B receives the broadcast and renders the Quick Tabs (even though Tab B is actually in Container 2)

---

### Issue 2: BroadcastChannel Already Created Before Container Detection

**Location:** `src/features/quick-tabs/index.js` - `init()` method

**Current Code Flow:**

```javascript
async init(eventBus, Events) {
  await this.detectContainerContext();  // Detects container FIRST
  this.setupBroadcastChannel();          // Then creates BroadcastChannel
}
```

**The Problem:**

While the order looks correct, there's a race condition:

1. `detectContainerContext()` is async and queries the browser API
2. If the tab switch happens during this async operation, the detection can return stale data
3. The BroadcastChannel is then created with the wrong container ID
4. The content script joins the wrong communication channel for the rest of its lifetime

**Impact:**

Once a content script joins the wrong BroadcastChannel, all future Quick Tab operations will leak across containers because broadcasts are sent to the wrong channel audience.

---

### Issue 3: Storage Sync Doesn't Validate Container Before Rendering

**Location:** `src/features/quick-tabs/index.js` - `syncFromStorage()`

**Current Code:**

```javascript
syncFromStorage(state, containerFilter = null) {
  const effectiveFilter = containerFilter || this.cookieStoreId;

  // Filters tabs by effectiveFilter
  tabsToSync.forEach(tabData => {
    this.createQuickTab({
      cookieStoreId: tabData.cookieStoreId || effectiveFilter
    });
  });
}
```

**The Problem:**

The method assigns `cookieStoreId` to created Quick Tabs, but it doesn't **validate** that the Quick Tab's container matches the current tab's actual container before rendering.

**Example Scenario:**

1. Content script in Tab B (Container 2) incorrectly detects `this.cookieStoreId = "firefox-container-1"` (due to Issue 1)
2. Storage sync receives Quick Tabs from Container 1
3. `syncFromStorage()` uses `effectiveFilter = "firefox-container-1"` (the WRONG container)
4. Quick Tabs from Container 1 are rendered in Tab B (which is actually in Container 2)

**Missing Validation:**

The code doesn't re-verify the current tab's container at render time. It trusts `this.cookieStoreId` set during `init()`, which may be stale.

---

### Issue 4: Background Script May Not Filter Recipients Correctly

**Location:** `background.js` - Message broadcasting logic

**Expected Behavior:**

When the background script broadcasts a Quick Tab creation message, it should use:

```javascript
browser.tabs.query({ cookieStoreId: targetContainer }).then(tabs => {
  // Send message only to tabs in targetContainer
});
```

**Current Behavior (Based on Code Review):**

The background script's message broadcasting logic was not fully analyzed from the logs, but based on the Quick Tab appearing across containers, there are two possibilities:

1. **The background script broadcasts to ALL tabs** without filtering by container
2. **The background script filters correctly, but content scripts with wrong `cookieStoreId` receive messages meant for other containers**

**Evidence:**

The logs show:

```
[QuickTabsManager] Message received: SYNC_QUICK_TAB_STATE_FROM_BACKGROUND
```

This message is being received by the content script. If the background script sent this message to **all tabs** instead of only tabs in the same container, it would cause cross-container visibility.

---

## Why Testing Didn't Reveal the Issue

**From the Logs:**

All Quick Tabs were created in `firefox-default` (the default container). The user likely opened tabs without explicitly assigning them to different containers.

**What Should Have Been Tested:**

1. Open Tab A and explicitly assign it to Container "Personal"
2. Create a Quick Tab in Tab A
3. Open Tab B and explicitly assign it to Container "Work"
4. Verify the Quick Tab from "Personal" does NOT appear in Tab B

**Why the Issue Was Missed:**

If both Tab A and Tab B are in the default container, the current implementation works correctly because all tabs share the same `cookieStoreId: "firefox-default"`.

---

## Diagnostic Summary

The container integration implementation in v1.5.9.12 includes the correct architectural components:

✅ Container context detection (`detectContainerContext()`)  
✅ Container-specific BroadcastChannel (`quick-tabs-sync-${cookieStoreId}`)  
✅ Container filtering in storage sync (`syncFromStorage()` with `containerFilter`)  
✅ Container validation in message listeners

However, there are critical implementation gaps:

❌ **Container detection has race conditions** - async timing can return stale container ID  
❌ **No re-validation of container context** - stale `this.cookieStoreId` is trusted throughout lifecycle  
❌ **Background script filtering unclear** - may broadcast to all tabs instead of filtering by container  
❌ **Broadcast channels joined once** - if wrong channel is joined during init, it's never corrected

---

## Detailed Fix Plan

### Fix 1: Make Container Detection Synchronous and Reliable

**Problem:** Async `browser.tabs.query()` can return stale data due to timing issues.

**Solution:** Use a **synchronous alternative** if available, or implement a **re-detection mechanism** before critical operations.

**Implementation:**

Instead of detecting container once during `init()`, **detect container context on-demand** before each operation that requires it:

1. **Before creating a Quick Tab** - detect the current tab's container
2. **Before broadcasting** - detect the current tab's container
3. **Before syncing from storage** - detect the current tab's container

This ensures the container context is always fresh and accurate.

**Pattern:**

```javascript
async getCurrentContainer() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0]?.cookieStoreId || 'firefox-default';
}

async createQuickTab(options) {
  // Re-detect container at time of creation
  const currentContainer = await this.getCurrentContainer();
  const cookieStoreId = options.cookieStoreId || currentContainer;

  // Validate: Don't create if container doesn't match
  if (currentContainer !== cookieStoreId) {
    console.warn(`[QuickTabsManager] Ignoring Quick Tab creation - container mismatch`);
    return;
  }

  // Proceed with creation...
}
```

**Why This Fixes Issue 1:**

By detecting the container **at the time of the operation**, we avoid stale container IDs caused by async timing and tab switches.

---

### Fix 2: Lazy BroadcastChannel Creation with Re-Joining

**Problem:** BroadcastChannel is created once during `init()` with potentially stale container ID.

**Solution:** Create BroadcastChannel **lazily** when needed, and allow **re-joining** if the container context changes.

**Implementation:**

1. **Remove BroadcastChannel creation from `init()`**
2. **Create a `getBroadcastChannel()` method** that:
   - Detects the current container
   - Checks if existing channel matches the container
   - If mismatch, closes old channel and creates new one
   - Returns the correct channel

**Pattern:**

```javascript
async getBroadcastChannel() {
  const currentContainer = await this.getCurrentContainer();
  const expectedChannelName = `quick-tabs-sync-${currentContainer}`;

  // Check if current channel is correct
  if (this.broadcastChannel && this.currentChannelName === expectedChannelName) {
    return this.broadcastChannel;
  }

  // Close old channel if it exists
  if (this.broadcastChannel) {
    this.broadcastChannel.close();
  }

  // Create new channel for current container
  this.broadcastChannel = new BroadcastChannel(expectedChannelName);
  this.currentChannelName = expectedChannelName;
  this.setupBroadcastHandlers(); // Attach message handlers

  return this.broadcastChannel;
}

async broadcast(type, data) {
  const channel = await this.getBroadcastChannel();
  channel.postMessage({ type, data });
}
```

**Why This Fixes Issue 2:**

Content scripts automatically switch to the correct BroadcastChannel when the tab's container context is detected, preventing them from listening to the wrong channel.

---

### Fix 3: Validate Container Before Rendering Quick Tabs

**Problem:** `syncFromStorage()` doesn't re-verify the current container before rendering Quick Tabs.

**Solution:** Add a **container validation check** before creating or rendering Quick Tabs from storage.

**Implementation:**

```javascript
async syncFromStorage(state, containerFilter = null) {
  // Re-detect current container for validation
  const currentContainer = await this.getCurrentContainer();

  // Use current container as filter if none provided
  const effectiveFilter = containerFilter || currentContainer;

  // CRITICAL: Validate that effective filter matches current container
  if (effectiveFilter !== currentContainer) {
    console.warn(
      `[QuickTabsManager] Refusing to sync - filter (${effectiveFilter}) doesn't match current container (${currentContainer})`
    );
    return;
  }

  // Extract tabs for current container only
  const tabsToSync = /* filter by effectiveFilter */;

  tabsToSync.forEach(tabData => {
    // Double-check each tab's container before creating
    if (tabData.cookieStoreId === currentContainer) {
      this.createQuickTab(tabData);
    } else {
      console.log(`[QuickTabsManager] Skipping tab ${tabData.id} - wrong container`);
    }
  });
}
```

**Why This Fixes Issue 3:**

Even if stale container IDs exist elsewhere, this validation prevents Quick Tabs from being rendered in the wrong container at the final rendering step.

---

### Fix 4: Ensure Background Script Filters Message Recipients

**Problem:** Background script may broadcast Quick Tab messages to all tabs instead of filtering by container.

**Solution:** Update the background script's message broadcasting logic to **query tabs by container before sending messages**.

**Implementation Pattern:**

```javascript
// In background.js
async function broadcastQuickTabOperation(operation, data) {
  const targetContainer = data.cookieStoreId;

  // Query only tabs in the target container
  const tabs = await browser.tabs.query({
    cookieStoreId: targetContainer
  });

  // Send message only to tabs in the same container
  for (const tab of tabs) {
    browser.tabs
      .sendMessage(tab.id, {
        action: operation,
        ...data,
        cookieStoreId: targetContainer // Always include for validation
      })
      .catch(() => {
        // Content script not loaded, ignore
      });
  }
}
```

**Why This Fixes Issue 4:**

By explicitly querying tabs by `cookieStoreId` before broadcasting, the background script ensures messages only reach tabs in the intended container, preventing cross-container leaks.

---

### Fix 5: Add Container Context Logging

**Problem:** Logs don't show when the container context changes or when detection fails.

**Solution:** Add detailed logging around container detection and validation.

**Implementation:**

```javascript
async getCurrentContainer() {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    const container = tabs[0]?.cookieStoreId || 'firefox-default';

    console.log(`[QuickTabsManager] Current container detected: ${container} (tab: ${tabs[0]?.id})`);

    // Log if container changed
    if (this.cookieStoreId && this.cookieStoreId !== container) {
      console.warn(`[QuickTabsManager] Container changed: ${this.cookieStoreId} -> ${container}`);
    }

    this.cookieStoreId = container;
    return container;
  } catch (err) {
    console.error('[QuickTabsManager] Failed to detect container:', err);
    return 'firefox-default';
  }
}
```

**Why This Helps:**

Enhanced logging makes it easier to diagnose container detection issues and verify that container isolation is working correctly during testing.

---

## Testing Plan

### Test Case 1: Basic Container Isolation

**Setup:**

1. Create Firefox Container "Personal" and "Work"
2. Open Tab A in "Personal" container
3. Open Tab B in "Work" container

**Test Steps:**

1. In Tab A, create a Quick Tab
2. Switch to Tab B
3. Verify Quick Tab from "Personal" does NOT appear in Tab B

**Expected Result:**

- Tab B (Work container) shows no Quick Tabs
- Only Tab A (Personal container) shows the Quick Tab

---

### Test Case 2: Cross-Tab Sync Within Same Container

**Setup:**

1. Create Firefox Container "Personal"
2. Open Tab A in "Personal" container
3. Open Tab C in "Personal" container

**Test Steps:**

1. In Tab A, create a Quick Tab
2. Switch to Tab C
3. Verify Quick Tab appears in Tab C

**Expected Result:**

- Tab C (same Personal container) shows the Quick Tab from Tab A
- Both tabs share the same Quick Tabs state

---

### Test Case 3: Quick Tab Manager Panel Isolation

**Setup:**

1. Create 3 Quick Tabs in "Personal" container
2. Create 5 Quick Tabs in "Work" container

**Test Steps:**

1. Open Quick Tab Manager in a tab in "Personal" container
2. Verify panel shows only 3 Quick Tabs
3. Switch to a tab in "Work" container
4. Open Quick Tab Manager
5. Verify panel shows only 5 Quick Tabs (not all 8)

**Expected Result:**

- Each container's panel is independent
- Managing Quick Tabs in one panel doesn't affect the other

---

### Test Case 4: Container Switching During Quick Tab Lifecycle

**Setup:**

1. Open Tab A in "Personal" container
2. Create a Quick Tab in Tab A

**Test Steps:**

1. While Quick Tab is open, switch Tab A's container to "Work"
2. Verify the Quick Tab behavior

**Expected Result:**

- Quick Tab either:
  - Closes automatically (if strict isolation is enforced)
  - Remains but stops syncing to "Personal" container tabs

---

## Implementation Priority

### Phase 1: Critical Fixes (Immediate)

1. **Fix 3: Validate container before rendering** - Prevents cross-container rendering
2. **Fix 5: Add container logging** - Makes issues visible for debugging

**Impact:** Prevents Quick Tabs from appearing in wrong containers even if detection fails

---

### Phase 2: Detection Improvements (High Priority)

3. **Fix 1: Synchronous container detection** - Eliminates race conditions
4. **Fix 2: Lazy BroadcastChannel creation** - Ensures correct channel membership

**Impact:** Fixes root cause of stale container detection

---

### Phase 3: Background Script (Important)

5. **Fix 4: Background script recipient filtering** - Prevents broadcast leaks

**Impact:** Ensures messages only reach intended container tabs

---

## Conclusion

The container integration in v1.5.9.12 has the right architecture but suffers from implementation issues:

**Core Issues:**

1. Container detection is async and can return stale data
2. BroadcastChannel is joined once with potentially wrong container ID
3. No validation before rendering Quick Tabs from storage
4. Background script may broadcast to all tabs instead of filtering

**Fix Strategy:**

Implement **on-demand container detection** and **validation at render time** to ensure Quick Tabs are never rendered in the wrong container, even if earlier detection failed.

The fixes prioritize **defensive validation** (reject wrong-container Quick Tabs at render time) over **perfect detection** (always detect the right container upfront), because defensive validation provides a fail-safe that prevents the bug even when detection has edge cases.

With these fixes, Quick Tabs will remain strictly isolated within their originating Firefox Container, and switching between containers will not cause Quick Tabs to leak across container boundaries.
