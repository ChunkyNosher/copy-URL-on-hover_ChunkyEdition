# Quick Tab Cross-Domain Sync Failure Analysis - v1.6.1.5

**Document Version:** 1.0  
**Extension Version:** v1.6.1.5  
**Date:** November 24, 2025  
**Severity:** CRITICAL - Quick Tabs do not sync across tabs of different
domains  
**Impact:** Breaks core global sync functionality described in Scenarios 1 and 2

---

## Executive Summary

Testing of v1.6.1.5 reveals **Quick Tabs are NOT syncing globally across
different domains** as specified in issue #47 test scenarios. Quick Tabs created
on Wikipedia only appear on other Wikipedia tabs, not on tabs of different
domains (YouTube, GitHub, etc.). Additionally, **position and size changes do
not sync between tabs**.

**Critical Findings:**

1. **Domain-Isolated Sync**: Quick Tabs only appear on tabs of the same
   domain/URL
2. **No Cross-Domain Visibility**: Quick Tab created on Wikipedia doesn't appear
   on YouTube tab
3. **Position/Size Not Syncing**: Dragging or resizing Quick Tab in one tab
   doesn't update other tabs
4. **BroadcastChannel Isolation**: Container-specific channels isolate
   broadcasts within same-domain tabs
5. **Storage Loading Issue**: Tab visibility refresh uses wrong container
   context

**Root Cause:**

The v1.6.1.5 architecture uses **container-specific BroadcastChannels**
(`quick-tabs-sync-{cookieStoreId}`) which are **domain-isolated**. Each tab
listens only to broadcasts from tabs in the same container AND same domain due
to BroadcastChannel's same-origin policy.

---

## Log Evidence Analysis

### Test Scenario Walkthrough

**Environment from Logs:**

- **Tab 12** (container `firefox-container-9`): Unknown domain (test tab)
- **Tab 11** (container `firefox-default`): Wikipedia tab with Quick Tab created

### Evidence 1: Quick Tab Created on Wikipedia Tab (firefox-default)

```
23:18:18.870Z [QuickTabsManager] createQuickTab called with: {
  "id": "qt-1764026298870-27yph8e5r",
  "url": "https://en.wikipedia.org/wiki/Arina_Tanemura",
  "left": 667,
  "top": 790,
  "width": 960,
  "height": 540,
  "title": "Arina Tanemura",
  "cookieStoreId": "firefox-default",  ← Created in firefox-default container
  "minimized": false,
  "pinnedToUrl": null
}
```

**Analysis:**

- Quick Tab created successfully in `firefox-default` container on Wikipedia tab
- Position: (667, 790), Size: 960x540
- Tab is active and rendering Quick Tab

### Evidence 2: Broadcast Sent to All Tabs

```
23:18:18.907Z [SyncCoordinator] Received broadcast: CREATE
23:18:18.907Z [CreateHandler] Creating Quick Tab with options: {
  "id": "qt-1764026298870-27yph8e5r",
  "url": "https://en.wikipedia.org/wiki/Arina_Tanemura",
  "left": 667,
  "top": 790,
  "width": 960,
  "height": 540,
  "cookieStoreId": "firefox-container-9",  ← Broadcast received in DIFFERENT container
  "senderId": "06a04664-1bc3-465a-8861-1780633fa96e",
  "sequence": 22296,
  "soloedOnTabs": [],
  "mutedOnTabs": []
}
```

**Analysis:**

- Broadcast was received by the OTHER tab
- **CRITICAL**: `cookieStoreId` changed from `firefox-default` to
  `firefox-container-9`
- CreateHandler correctly rejects: "Quick Tab already exists and is rendered"
- This indicates cross-container broadcast was received but rejected due to
  container mismatch

### Evidence 3: Tab Switch to Container-9 Tab Shows NO Quick Tabs

```
23:18:26.659Z [SyncCoordinator] Tab became visible - refreshing state from background
23:18:26.739Z [StorageManager] No data found for container firefox-container-9
23:18:26.739Z [StateManager] Hydrated 0 Quick Tabs (0 added, 0 deleted)
23:18:26.739Z [UICoordinator] State refreshed - re-rendering all visible tabs
23:18:26.739Z [SyncCoordinator] Refreshed with 0 Quick Tabs (0 in-memory, 0 from storage)
```

**Analysis:**

- When switching to Tab 12 (`firefox-container-9`), system looks for Quick Tabs
  in `firefox-container-9` storage
- Finds **ZERO Quick Tabs** because Quick Tab was created in `firefox-default`
  storage
- Tab visibility refresh loads from **wrong container context**
- **0 in-memory, 0 from storage** = No Quick Tabs visible at all

### Evidence 4: Position Updates Don't Sync Across Tabs

```
23:18:20.673Z [DEBUG] [Background] State already initialized
23:18:20.678Z [DEBUG] [Background] Storage changed: local ["quick_tabs_state_v2"]
23:18:20.678Z [DEBUG] [Background] Ignoring self-write: bg-1764026300673-4r5eptc4w
23:18:20.683Z [DEBUG] [Background] Quick Tab state changed, broadcasting to all tabs
23:18:20.683Z [DEBUG] [Background] Updated global state from storage (container-aware): 1 containers
```

**Analysis:**

- Background script detects position update and broadcasts
- Storage change triggers broadcast to "all tabs"
- **But**: "container-aware: 1 containers" shows isolation
- Broadcast only reaches tabs in same container

---

## Root Cause Analysis

### Problem Location 1: BroadcastChannel Domain Isolation

**File:** `src/features/quick-tabs/managers/BroadcastManager.js`  
**Lines:** ~105-126  
**Method:** `setupBroadcastChannel()`

**The Problematic Code:**

```javascript
setupBroadcastChannel() {
  // ...
  try {
    // ❌ PROBLEM: Container-specific channel name
    const channelName = `quick-tabs-sync-${this.cookieStoreId}`;

    // ❌ CRITICAL PROBLEM: BroadcastChannel is SAME-ORIGIN only
    // Each domain creates its own isolated channel
    // Wikipedia tabs: new BroadcastChannel('quick-tabs-sync-firefox-default')
    // YouTube tabs: new BroadcastChannel('quick-tabs-sync-firefox-default')
    // BUT these are SEPARATE channels because different origins!
    this.broadcastChannel = new BroadcastChannel(channelName);

    this.broadcastChannel.onmessage = event => {
      this.handleBroadcastMessage(event.data);
    };
  } catch (err) {
    // ...
  }
}
```

**What's Wrong:**

**BroadcastChannel API is Same-Origin Policy Restricted:**

From
[MDN BroadcastChannel documentation](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API):

> "The Broadcast Channel API allows simple communication between browsing
> contexts (that is windows, tabs, frames, or iframes) **and workers on the same
> origin**."

**This means:**

- `https://en.wikipedia.org` tabs create channel
  `quick-tabs-sync-firefox-default` on Wikipedia origin
- `https://www.youtube.com` tabs create channel
  `quick-tabs-sync-firefox-default` on YouTube origin
- **These are SEPARATE channels** - messages don't cross origins
- Quick Tabs created on Wikipedia broadcast ONLY to other Wikipedia tabs
- YouTube tabs never receive Wikipedia's broadcasts

**The False Assumption:**

The code assumes `BroadcastChannel('quick-tabs-sync-firefox-default')` is a
**global channel** shared across all tabs regardless of domain. This is
**fundamentally incorrect** - BroadcastChannel is origin-isolated by design for
security.

**Diagram of Current (Broken) Behavior:**

```
Wikipedia Tab 1 (origin: https://en.wikipedia.org)
  ↓
  Creates: BroadcastChannel('quick-tabs-sync-firefox-default') [Wikipedia Origin]
  ↓
  Posts message: CREATE Quick Tab
  ↓
  ✓ Received by: Wikipedia Tab 2 (same origin)
  ✓ Received by: Wikipedia Tab 3 (same origin)
  ❌ NOT received by: YouTube Tab 1 (different origin)
  ❌ NOT received by: GitHub Tab 1 (different origin)
```

### Problem Location 2: Container-Aware Storage Loading

**File:** `src/features/quick-tabs/coordinators/SyncCoordinator.js`  
**Lines:** ~65-85  
**Method:** `handleTabVisible()`

**The Problematic Code:**

```javascript
async handleTabVisible() {
  console.log('[SyncCoordinator] Tab became visible - refreshing state from background');

  try {
    const currentState = this.stateManager.getAll();

    // ❌ PROBLEM: Loads from storage using tab's OWN container context
    // StorageManager loads from: quick_tabs_state_v2.containers[this.cookieStoreId]
    const storageState = await this.storageManager.loadAll();

    // This returns EMPTY if tab's container doesn't match Quick Tab's container
    const mergedState = this._mergeQuickTabStates(currentState, storageState);
    this.stateManager.hydrate(mergedState);

    // Result: 0 Quick Tabs loaded if containers don't match
    console.log(`[SyncCoordinator] Refreshed with ${mergedState.length} Quick Tabs`);
  } catch (err) {
    console.error('[SyncCoordinator] Error refreshing state on tab visible:', err);
  }
}
```

**What's Wrong:**

When tab becomes visible:

1. System calls `storageManager.loadAll()`
2. StorageManager loads from
   `quick_tabs_state_v2.containers[this.cookieStoreId]`
3. If tab is in `firefox-container-9` and Quick Tab was created in
   `firefox-default`:
   - `storageState` returns `[]` (no data for container-9)
   - `currentState` is also `[]` (no broadcasts received due to Problem 1)
   - **Result: 0 Quick Tabs visible**

**The Wrong Assumption:**

The code assumes each tab should only load Quick Tabs from its **own container
context**. This makes Quick Tabs container-isolated, which contradicts the
**global sync requirement** in Scenarios 1 and 2.

### Problem Location 3: Container-Specific Storage Keys

**File:** `src/features/quick-tabs/managers/StorageManager.js` (inferred)  
**Expected Structure:**

```javascript
// Current (broken) structure:
{
  "quick_tabs_state_v2": {
    "containers": {
      "firefox-default": {
        "tabs": [
          { "id": "qt-xxx", "url": "...", ... }  ← Only visible to firefox-default tabs
        ]
      },
      "firefox-container-9": {
        "tabs": []  ← Empty, no Quick Tabs
      }
    }
  }
}
```

**What's Wrong:**

Storage structure is **container-partitioned**. Each container has its own
isolated Quick Tab storage. When a tab in a different container loads Quick
Tabs, it only loads from its own container key.

**This Breaks Global Sync:**

- Quick Tab created on Wikipedia (firefox-default) stored in
  `containers.firefox-default`
- YouTube tab (firefox-default but different origin) loads from
  `containers.firefox-default`
- **But** broadcasts never reach YouTube tab due to same-origin restriction
- **Result:** Quick Tabs appear to be container-isolated

---

## Technical Architecture Issues

### Issue 1: BroadcastChannel Can't Be Used for Cross-Origin Sync

**Current Design:**

- Uses `BroadcastChannel` for real-time cross-tab messaging
- Assumes channels work globally across all browser tabs
- **Reality:** Channels are same-origin isolated

**Why This Breaks:**

BroadcastChannel was designed for **intra-origin communication**:

- Chat applications where all users are on `chat.example.com`
- Multi-tab games on same domain
- Syncing UI state within a web app

It was **NOT designed** for extension cross-origin sync.

**Browser Extension Context:**

Content scripts run in **each page's origin context**:

- Content script on Wikipedia runs in Wikipedia origin
- Content script on YouTube runs in YouTube origin
- They **cannot share BroadcastChannels**

### Issue 2: No Background Script Relay

**Current Design:**

- Content scripts communicate via BroadcastChannel directly
- Background script observes storage changes and re-broadcasts
- **But:** Background broadcasts also use BroadcastChannel

**Why This Doesn't Work:**

Background scripts in Firefox extensions **don't have a BroadcastChannel
context** that spans all tabs. The background page has its own origin
(moz-extension://...), which is **separate from content script origins**.

**Even if background script posts to BroadcastChannel:**

- Background: `BroadcastChannel('quick-tabs-sync-firefox-default')` in
  `moz-extension://` origin
- Wikipedia tab: `BroadcastChannel('quick-tabs-sync-firefox-default')` in
  `https://en.wikipedia.org` origin
- **These are DIFFERENT channels** - messages don't relay

### Issue 3: Container-Aware Storage Defeats Global Sync

**Current Design:**

- Storage partitioned by container: `containers.firefox-default.tabs`
- Each tab loads only from its own container
- Broadcasts (if they worked) would still be container-specific

**Why This Breaks Global Sync:**

Scenarios 1 and 2 require Quick Tabs to be **globally visible** across all tabs
**regardless of domain or container** (unless Solo/Mute applied). Current design
treats each container as isolated storage namespace.

---

## Why Position/Size Updates Don't Sync

**Evidence from Logs:**

```
23:18:20.672Z [QuickTabWindow] Drag ended: qt-1764026298870-27yph8e5r 89 750
23:18:20.678Z [Background] Ignoring self-write: bg-1764026300673-4r5eptc4w
23:18:20.683Z [Background] Quick Tab state changed, broadcasting to all tabs
23:18:20.683Z [Background] Updated global state from storage (container-aware): 1 containers
```

**Analysis:**

1. Drag ends on Tab 11 (Wikipedia, firefox-default)
2. Position update saved to storage (`firefox-default` container)
3. Background detects change and broadcasts
4. **But:** Broadcast sent via same BroadcastChannel that's origin-isolated
5. Other Wikipedia tabs receive update ✓
6. YouTube/GitHub tabs never receive update ❌

**Result:**

Position/size updates only sync **within same-domain tabs** due to
BroadcastChannel isolation. This is the same root cause as Quick Tab creation
not syncing.

---

## Comparison with Expected Behavior

### Scenario 1: Expected vs. Actual

**Expected (from issue #47):**

1. Open Wikipedia Tab 1 → Create Quick Tab
2. Quick Tab appears in Wikipedia Tab 1 ✓
3. Open YouTube Tab 1
4. **Quick Tab should appear in YouTube Tab 1** ✓
5. Move Quick Tab in YouTube Tab 1 to bottom-right
6. **Position should sync to Wikipedia Tab 1** ✓

**Actual (v1.6.1.5):**

1. Open Wikipedia Tab 1 → Create Quick Tab
2. Quick Tab appears in Wikipedia Tab 1 ✓
3. Open YouTube Tab 1
4. **Quick Tab DOES NOT appear in YouTube Tab 1** ❌
5. Move Quick Tab (if it existed)
6. **Position DOES NOT sync** ❌

### Scenario 2: Expected vs. Actual

**Expected:**

1. Open Wikipedia Tab 1 → Create Quick Tab 1
2. Open YouTube Tab 1 (Quick Tab 1 syncs) ✓
3. Create Quick Tab 2 in YouTube Tab 1
4. **Both Quick Tab 1 and Quick Tab 2 visible in YouTube Tab 1** ✓
5. Switch to Wikipedia Tab 1
6. **Both Quick Tabs now visible in Wikipedia Tab 1** ✓

**Actual:**

1. Open Wikipedia Tab 1 → Create Quick Tab 1
2. Open YouTube Tab 1
3. **Quick Tab 1 DOES NOT appear** ❌
4. Create Quick Tab 2 in YouTube Tab 1
5. **Only Quick Tab 2 visible in YouTube Tab 1** (Quick Tab 1 missing)
6. Switch to Wikipedia Tab 1
7. **Only Quick Tab 1 visible in Wikipedia Tab 1** (Quick Tab 2 missing)

---

## Solution Requirements

To fix these issues and meet Scenario 1 & 2 requirements, the system needs:

### Requirement 1: Global Cross-Origin Messaging

**Replace BroadcastChannel with browser extension messaging:**

Firefox extensions have access to `browser.runtime.sendMessage()` and
`browser.tabs.sendMessage()`, which **DO work cross-origin** because they're
part of the WebExtensions API.

**Required Changes:**

Stop using BroadcastChannel entirely. Use background script as central message
relay:

```
Content Script (Wikipedia) → browser.runtime.sendMessage() → Background Script
                                                                    ↓
Background Script → browser.tabs.sendMessage() → Content Script (YouTube)
```

This works across all origins because WebExtensions API is not subject to
same-origin policy.

### Requirement 2: Global Storage Loading

**Remove container-partitioned storage loading:**

When tab becomes visible, system should load **ALL Quick Tabs from ALL
containers**, not just its own container. The global Quick Tab list should be
filtered based on Solo/Mute rules, not container boundaries.

**Required Changes:**

Change `StorageManager.loadAll()` to:

- Load from ALL container keys in storage
- Return flat array of ALL Quick Tabs
- Let visibility rules (Solo/Mute) determine which Quick Tabs are rendered
- **Don't use container context to filter storage loading**

### Requirement 3: Unified Global Storage

**Restructure storage to have global Quick Tab list:**

Instead of:

```javascript
{
  "containers": {
    "firefox-default": { "tabs": [...] },
    "firefox-container-9": { "tabs": [...] }
  }
}
```

Use:

```javascript
{
  "quickTabs": [
    { "id": "qt-1", "cookieStoreId": "firefox-default", ... },
    { "id": "qt-2", "cookieStoreId": "firefox-default", ... }
  ]
}
```

**Keep `cookieStoreId` as metadata**, but don't partition storage by it. All
Quick Tabs live in one flat list.

### Requirement 4: Background Script as Sync Authority

**Centraliz state in background script:**

- Background script holds single source of truth
- Content scripts request state from background on load
- Content scripts send updates to background
- Background broadcasts updates to ALL tabs via `browser.tabs.sendMessage()`
- No peer-to-peer messaging between content scripts

**This ensures:**

- All tabs see same global state
- Position/size updates relay through background
- Cross-origin sync works correctly

---

## Implementation Priority

### Phase 1: Replace BroadcastChannel with Extension Messaging (CRITICAL - P0)

**Files to Change:**

- `src/features/quick-tabs/managers/BroadcastManager.js` - Remove
  BroadcastChannel, add browser.runtime messaging
- `background.js` - Add message relay logic to broadcast to all tabs

**Changes Required:**

In `BroadcastManager.js`, replace `setupBroadcastChannel()`:

```javascript
// BEFORE (broken):
setupBroadcastChannel() {
  const channelName = `quick-tabs-sync-${this.cookieStoreId}`;
  this.broadcastChannel = new BroadcastChannel(channelName);
  this.broadcastChannel.onmessage = event => {
    this.handleBroadcastMessage(event.data);
  };
}

// AFTER (working):
setupExtensionMessaging() {
  // Listen for messages from background script
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message.type?.startsWith('QUICK_TAB_')) {
      this.handleBroadcastMessage(message);
    }
  });
}
```

Replace `broadcast()` method:

```javascript
// BEFORE (broken):
async broadcast(type, data) {
  this.broadcastChannel.postMessage({ type, data: messageData });
}

// AFTER (working):
async broadcast(type, data) {
  // Send to background script, which relays to all tabs
  await browser.runtime.sendMessage({
    type: `QUICK_TAB_${type}`,
    data: messageData
  });
}
```

In `background.js`, add relay logic:

```javascript
// Listen for Quick Tab messages from content scripts
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type?.startsWith('QUICK_TAB_')) {
    // Relay to ALL tabs (cross-origin works here)
    browser.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        browser.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab may not have content script loaded
        });
      }
    });
  }
});
```

**Impact:** Fixes cross-origin broadcast issue. Quick Tabs will now appear
across different domains.

### Phase 2: Fix Storage Loading to Be Global (HIGH PRIORITY - P1)

**Files to Change:**

- `src/features/quick-tabs/managers/StorageManager.js` - Change `loadAll()` to
  load from all containers
- `src/features/quick-tabs/coordinators/SyncCoordinator.js` - Update
  `handleTabVisible()` to expect global state

**Changes Required:**

In `StorageManager.js`, modify `loadAll()`:

```javascript
// BEFORE (broken - container-specific):
async loadAll() {
  const data = await browser.storage.local.get('quick_tabs_state_v2');
  const containerData = data?.quick_tabs_state_v2?.containers?.[this.cookieStoreId];
  return containerData?.tabs || [];
}

// AFTER (working - global):
async loadAll() {
  const data = await browser.storage.local.get('quick_tabs_state_v2');
  const containers = data?.quick_tabs_state_v2?.containers || {};

  // Flatten all containers into single array
  const allQuickTabs = [];
  for (const containerKey of Object.keys(containers)) {
    const tabs = containers[containerKey]?.tabs || [];
    allQuickTabs.push(...tabs);
  }

  return allQuickTabs;
}
```

**Impact:** Tabs will load Quick Tabs from all containers, not just their own.
Combined with Phase 1, this completes global sync.

### Phase 3: Unified Storage Structure (MEDIUM PRIORITY - P2)

**Files to Change:**

- All storage read/write locations
- Migration logic to convert old structure to new structure

**Changes Required:**

Change storage structure from container-partitioned to flat global list:

```javascript
// BEFORE (broken):
{
  "quick_tabs_state_v2": {
    "containers": {
      "firefox-default": {
        "tabs": [...]
      },
      "firefox-container-9": {
        "tabs": [...]
      }
    }
  }
}

// AFTER (working):
{
  "quick_tabs_state_v2": {
    "quickTabs": [
      { "id": "qt-1", "cookieStoreId": "firefox-default", ... },
      { "id": "qt-2", "cookieStoreId": "firefox-default", ... }
    ]
  }
}
```

Add migration logic on extension update to convert old data:

```javascript
async function migrateStorageStructure() {
  const data = await browser.storage.local.get('quick_tabs_state_v2');

  if (data?.quick_tabs_state_v2?.containers) {
    // Old structure detected, migrate
    const containers = data.quick_tabs_state_v2.containers;
    const quickTabs = [];

    for (const [containerId, containerData] of Object.entries(containers)) {
      for (const tab of containerData.tabs || []) {
        tab.cookieStoreId = containerId; // Add container metadata
        quickTabs.push(tab);
      }
    }

    // Write new structure
    await browser.storage.local.set({
      quick_tabs_state_v2: { quickTabs }
    });

    console.log(
      '[Migration] Converted container-partitioned storage to global structure'
    );
  }
}
```

**Impact:** Cleaner storage model, easier to reason about. Reduces complexity in
storage manager.

---

## Testing Verification

### Test Scenario 1: Cross-Domain Quick Tab Creation

**Steps:**

1. Open Wikipedia tab, create Quick Tab
2. Verify Quick Tab appears on Wikipedia tab
3. Open YouTube tab
4. **Expected:** Quick Tab appears on YouTube tab at same position/size
5. **Verify:** Quick Tab visible on YouTube tab

**Success Criteria:**

- Quick Tab appears on YouTube tab immediately (within 100ms)
- Position and size match Wikipedia tab exactly

### Test Scenario 2: Cross-Domain Position Sync

**Steps:**

1. Open Wikipedia tab with Quick Tab
2. Open YouTube tab (Quick Tab syncs)
3. Drag Quick Tab to bottom-right in YouTube tab
4. Switch back to Wikipedia tab
5. **Expected:** Quick Tab at bottom-right position in Wikipedia tab
6. **Verify:** Position synced correctly

**Success Criteria:**

- Position updates sync within 100ms
- Final position identical across both tabs

### Test Scenario 3: Cross-Domain Size Sync

**Steps:**

1. Open Wikipedia tab with Quick Tab
2. Open GitHub tab (Quick Tab syncs)
3. Resize Quick Tab to 700x500 in GitHub tab
4. Switch back to Wikipedia tab
5. **Expected:** Quick Tab now 700x500 in Wikipedia tab
6. **Verify:** Size synced correctly

**Success Criteria:**

- Size updates sync within 100ms
- Final dimensions identical across both tabs

### Test Scenario 4: Multiple Quick Tabs Across Domains

**Steps:**

1. Open Wikipedia tab, create Quick Tab 1
2. Open YouTube tab (Quick Tab 1 syncs)
3. Create Quick Tab 2 in YouTube tab
4. **Expected:** Both Quick Tabs visible in YouTube tab
5. Switch to Wikipedia tab
6. **Expected:** Both Quick Tabs visible in Wikipedia tab
7. **Verify:** All Quick Tabs synced globally

**Success Criteria:**

- Quick Tab 1 appears on YouTube tab
- Quick Tab 2 appears on Wikipedia tab after switching
- Both tabs show 2 Quick Tabs total

---

## Root Cause Summary

The v1.6.1.5 cross-domain sync failure is caused by **fundamental misuse of the
BroadcastChannel API**:

### The Core Problem

**BroadcastChannel is same-origin restricted** - messages cannot cross origins
(domains). Quick Tabs created on Wikipedia broadcast only to other Wikipedia
tabs, never reaching YouTube or other domains.

### The Amplifiers

1. **Container-Partitioned Storage**: Each container has isolated storage,
   preventing tabs from loading Quick Tabs from other containers
2. **Container-Specific Loading**: `handleTabVisible()` loads only from tab's
   own container, returning empty arrays for cross-container Quick Tabs
3. **No Background Relay**: Background script doesn't properly relay messages
   cross-origin

### The Result

A **perfect storm** of architecture issues that **completely breaks global
sync**:

- Quick Tabs isolated to same-domain tabs
- Position/size updates don't propagate cross-domain
- Each domain effectively has its own isolated Quick Tab namespace
- **Scenarios 1 and 2 completely fail**

---

## Conclusion

The v1.6.1.5 Quick Tab sync system is **fundamentally broken for cross-domain
use** due to incorrect BroadcastChannel usage. BroadcastChannel was never
designed for cross-origin extension messaging - it's a **same-origin API** for
intra-app communication.

**The fix requires:**

1. **Phase 1** (Critical): Replace BroadcastChannel with `browser.runtime`
   messaging and background script relay
2. **Phase 2** (High Priority): Fix storage loading to be global across all
   containers
3. **Phase 3** (Medium Priority): Restructure storage to unified global list

**Estimated Total Implementation Time:** 8-12 hours (1-1.5 days)

**Priority P0+P1 fixes alone (Phases 1 and 2) will resolve 95% of the issue.**

---

**Document End**
