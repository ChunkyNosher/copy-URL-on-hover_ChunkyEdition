# Firefox Container Tabs Integration for Quick Tabs Feature - Implementation Framework

## Overview

This document outlines the architectural framework changes required to integrate
Firefox Container Tabs API into the Quick Tabs feature, ensuring complete
container isolation where Quick Tabs in one Firefox Container remain invisible
and unsynchronized with Quick Tabs in other containers.

**Critical Context:** Container integration does NOT currently exist in the
extension. Any references to container-aware code in the codebase are remnants
from pre-refactor versions and are not functional in the current architecture.

---

## Required Behavioral Outcomes

### Outcome 1: Container-Isolated Quick Tab Visibility

When a Quick Tab is created in Tab A (Firefox Container 1), and the user
switches to Tab B (Firefox Container 2), the Quick Tab from Container 1 must NOT
appear in Tab B. Quick Tabs are container-scoped and only visible within their
originating container.

### Outcome 2: Container-Isolated Quick Tab Manager

When the Quick Tab Manager panel is opened in Container 1 showing 4 Quick Tabs,
and then opened in Container 2 showing 6 Quick Tabs, the two instances must be
completely independent. Managing tabs in Container 1's panel must not affect
Container 2's tabs, and vice versa.

---

## Firefox Container API Background

### How Firefox Containers Work

Firefox Containers isolate browsing contexts using the **`cookieStoreId`**
property[9][15][36]. Each container has a unique identifier:

- **Default container:** `"firefox-default"`[14]
- **Container 1:** `"firefox-container-1"`[14][15]
- **Container 2:** `"firefox-container-2"`[14]
- **Private browsing:** `"firefox-private"`[14]

### Key Firefox APIs for Container Detection

**Detecting Current Tab's Container** (Content Script Context)[36][40]:

```javascript
// tabs.query() to get current tab with cookieStoreId
browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  const cookieStoreId = tabs[0].cookieStoreId;
  // Use this to filter operations
});
```

**Note:** `browser.tabs.getCurrent()` only works in browser tab contexts
(options page, popup), NOT in content scripts[40]. Content scripts must use
`tabs.query()` instead.

**Querying Container Information**[9][16]:

```javascript
// Get all containers with metadata (name, icon, color)
browser.contextualIdentities.query({}).then(containers => {
  // containers array contains: name, icon, color, cookieStoreId
});
```

**Querying Tabs by Container**[15][36]:

```javascript
// Get all tabs in a specific container
browser.tabs.query({ cookieStoreId: 'firefox-container-1' }).then(tabs => {
  // tabs array contains only tabs from Container 1
});
```

### Required Manifest Permissions

The extension manifest must include[9][15]:

```json
{
  "permissions": ["contextualIdentities", "cookies"]
}
```

**Current Status:** The extension already has these permissions in
`manifest.json`.

---

## Architecture Framework Changes

### 1. QuickTabsManager: Container Context Detection

**Location:** `src/features/quick-tabs/index.js` - `QuickTabsManager` class

**Framework Change Required:**

The `QuickTabsManager` needs a persistent container identity that represents
which Firefox Container it's operating in. This identity must be:

1. **Detected during initialization** using `browser.tabs.query()` (not
   `getCurrent()`)
2. **Stored as an instance property** (`this.cookieStoreId`)
3. **Used as a filter** for all Quick Tab operations (create, sync, broadcast,
   etc.)

**Implementation Pattern:**

During `init()`:

- Query the current tab using
  `browser.tabs.query({ active: true, currentWindow: true })`[36][38]
- Extract `cookieStoreId` from the result
- Store it as `this.cookieStoreId` for the lifecycle of the manager instance
- Default to `"firefox-default"` if detection fails

**Why This Pattern:**

- Content scripts cannot use `browser.tabs.getCurrent()`[40]
- `tabs.query()` with `active: true` and `currentWindow: true` reliably returns
  the current tab in content script context[36][38]
- Storing the container ID avoids repeated API calls

---

### 2. Storage Structure: Container-Keyed State

**Location:** Browser storage (`browser.storage.sync` and
`browser.storage.session`)

**Framework Change Required:**

The Quick Tabs state must be organized by `cookieStoreId` keys to enable
per-container isolation. The storage schema should be:

```javascript
{
  "quick_tabs_state_v2": {
    "firefox-default": {
      tabs: [
        { id: "qt-1", url: "...", left: 100, top: 100, ... }
      ],
      lastUpdate: timestamp
    },
    "firefox-container-1": {
      tabs: [
        { id: "qt-2", url: "...", left: 200, top: 200, ... }
      ],
      lastUpdate: timestamp
    },
    "firefox-container-2": {
      tabs: [ /* separate tabs */ ],
      lastUpdate: timestamp
    }
  }
}
```

**Storage Operations Pattern:**

**When saving state:**

- Read the current `this.cookieStoreId`
- Update only the state under that specific container key
- Leave other containers' state unchanged

**When loading state:**

- Read the entire storage structure
- Extract only the state for `this.cookieStoreId`
- Ignore state from other containers

**Why This Pattern:**

- Each container maintains its own Quick Tabs list
- Storage changes in one container don't affect others
- Background script can manage cross-container state without conflict

---

### 3. BroadcastChannel: Container-Specific Channels

**Location:** `src/features/quick-tabs/index.js` - `setupBroadcastChannel()`

**Framework Change Required:**

Instead of using a single global BroadcastChannel for all tabs, create
**container-specific channels** based on the `cookieStoreId`.

**Channel Naming Pattern:**

- Container 1: `"quick-tabs-sync-firefox-container-1"`
- Container 2: `"quick-tabs-sync-firefox-container-2"`
- Default: `"quick-tabs-sync-firefox-default"`

**Implementation Pattern:**

During `setupBroadcastChannel()`:

- Use the stored `this.cookieStoreId` to generate a unique channel name
- Create BroadcastChannel with:
  `new BroadcastChannel('quick-tabs-sync-' + this.cookieStoreId)`
- All broadcast operations (create, update, close, etc.) use this
  container-specific channel

**Message Flow:**

1. Tab A in Container 1 creates a Quick Tab
2. Tab A broadcasts on `quick-tabs-sync-firefox-container-1`
3. Tab B in Container 1 receives the broadcast and creates the Quick Tab
4. Tab C in Container 2 listens to `quick-tabs-sync-firefox-container-2` and
   receives nothing

**Why This Pattern:**

- Tabs in different containers listen to different channels
- Broadcasts are automatically isolated by container
- No manual filtering needed in message handlers

---

### 4. State Synchronization: Container Filtering

**Location:** `src/features/quick-tabs/index.js` - `syncFromStorage()`

**Framework Change Required:**

The `syncFromStorage()` method must filter the state it processes to only
include Quick Tabs from the current container.

**Current Problem:** The method accepts a `containerFilter` parameter but
sometimes processes all containers when the parameter is null or missing.

**Implementation Pattern:**

**Always enforce container filtering:**

- Never allow `containerFilter` to be null or undefined
- Always pass `this.cookieStoreId` as the filter parameter
- If state contains multiple containers, extract only the current container's
  data before processing

**Caller Locations to Update:**

1. `setupStorageListeners()` - When storage changes, pass `this.cookieStoreId`
2. `scheduleStorageSync()` - Pass `this.cookieStoreId` when calling
   `syncFromStorage()`
3. `hydrateStateFromStorage()` - Pass `this.cookieStoreId` during initial load

**Why This Pattern:**

- Prevents rendering Quick Tabs from other containers
- Enforces container isolation at the synchronization layer
- Ensures storage changes only affect the correct container's tabs

---

### 5. Background Script: Container-Aware Message Broadcasting

**Location:** `background.js` - Message handler and storage sync logic

**Framework Change Required:**

When the background script broadcasts Quick Tab operations (create, close,
update) to content scripts, it must include the `cookieStoreId` in the message
payload and only send to tabs in the matching container.

**Implementation Pattern:**

**When sending messages:**

1. Extract `cookieStoreId` from the Quick Tab operation
2. Query tabs using:
   `browser.tabs.query({ cookieStoreId: cookieStoreId })`[15][36]
3. Send messages only to tabs in the result set

**Message Payload:** All messages must include:

```javascript
{
  action: "CREATE_QUICK_TAB_FROM_BACKGROUND",
  id: "qt-123",
  url: "https://example.com",
  cookieStoreId: "firefox-container-1",  // REQUIRED
  // ... other properties
}
```

**Why This Pattern:**

- Background script controls which tabs receive Quick Tab notifications
- Tabs in Container 2 never receive messages about Container 1's Quick Tabs
- Explicit container ID in messages enables recipient validation

---

### 6. Content Script: Message Filtering by Container

**Location:** `src/features/quick-tabs/index.js` - `setupMessageListeners()`

**Framework Change Required:**

When content scripts receive messages from the background script, they must
validate that the message's `cookieStoreId` matches their own
`this.cookieStoreId` before processing.

**Implementation Pattern:**

**Message validation:**

```javascript
browser.runtime.onMessage.addListener((message, sender) => {
  // Validate sender identity
  if (!sender.id || sender.id !== browser.runtime.id) {
    return; // Reject unknown senders
  }

  // Validate container context
  if (message.cookieStoreId && message.cookieStoreId !== this.cookieStoreId) {
    // Message is for a different container - ignore it
    return;
  }

  // Process message...
  switch (message.action) {
    case 'CREATE_QUICK_TAB_FROM_BACKGROUND':
      this.createQuickTab(message);
      break;
  }
});
```

**Why This Pattern:**

- Defense-in-depth: Even if background script sends to wrong tabs, content
  script filters it
- Prevents cross-container Quick Tab rendering
- Explicit validation makes container isolation behavior clear

---

### 7. Storage Event Listeners: Container Context Extraction

**Location:** `src/features/quick-tabs/index.js` - `setupStorageListeners()`

**Framework Change Required:**

When `browser.storage.onChanged` fires, the listener must extract only the
current container's state from the change before triggering a sync.

**Implementation Pattern:**

**Storage change handler:**

```javascript
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.quick_tabs_state_v2) {
    const newValue = changes.quick_tabs_state_v2.newValue;

    // Extract only current container's state
    const containerState = newValue?.[this.cookieStoreId];

    if (containerState) {
      // Only sync current container's data
      const filteredState = {
        [this.cookieStoreId]: containerState
      };
      this.syncFromStorage(filteredState, this.cookieStoreId);
    }
  }
});
```

**Why This Pattern:**

- Storage contains all containers' states, but each tab only processes its own
- Prevents a storage change in Container 1 from triggering sync in Container 2
- Reduces unnecessary processing and UI updates

---

### 8. Quick Tab Manager Panel: Container-Scoped Content

**Location:** `src/features/quick-tabs/panel.js` - `PanelManager` class

**Framework Change Required:**

The Quick Tab Manager panel must detect which container it's opened in and
display only Quick Tabs from that container.

**Implementation Pattern:**

**During panel open:**

1. Detect the current tab's container using
   `browser.tabs.query({ active: true, currentWindow: true })`[36]
2. Store the container ID: `this.currentContainerId = tab.cookieStoreId`
3. Use this ID when loading Quick Tabs state for the panel

**Panel content rendering:**

```javascript
async updatePanelContent() {
  // Get current container
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentContainer = tabs[0]?.cookieStoreId || 'firefox-default';

  // Load Quick Tabs state
  const result = await browser.storage.sync.get('quick_tabs_state_v2');
  const allState = result.quick_tabs_state_v2;

  // Extract only current container's tabs
  const containerTabs = allState?.[currentContainer]?.tabs || [];

  // Render only these tabs in the panel
  this.renderQuickTabsList(containerTabs);
}
```

**Why This Pattern:**

- Panel shows only Quick Tabs from the container it's opened in
- Matches the expected behavior: Container 1's panel manages Container 1's tabs
- Each container's panel is independent

---

### 9. Quick Tab Creation: Automatic Container Assignment

**Location:** `src/features/quick-tabs/index.js` - `createQuickTab()`

**Framework Change Required:**

When a Quick Tab is created, it must automatically inherit the container context
from the tab it was created in.

**Implementation Pattern:**

**Quick Tab object structure:**

```javascript
{
  id: "qt-123",
  url: "https://example.com",
  cookieStoreId: this.cookieStoreId,  // Automatically set from manager instance
  left: 100,
  top: 100,
  width: 800,
  height: 600,
  // ... other properties
}
```

**Creation flow:**

1. User triggers Quick Tab creation (e.g., press Q while hovering)
2. `createQuickTab()` is called
3. Method automatically sets `cookieStoreId: this.cookieStoreId` on the Quick
   Tab object
4. Quick Tab is saved to storage under the correct container key
5. Broadcast is sent on the container-specific channel

**Why This Pattern:**

- Quick Tabs are automatically assigned to the correct container
- No manual container management required in creation logic
- Container context propagates throughout the system

---

## Implementation Priority

### Phase 1: Foundation (Critical)

**Goal:** Establish container context and prevent cross-container visibility

1. **Add container detection to QuickTabsManager initialization**
   - Store `this.cookieStoreId` during `init()`
   - Use `browser.tabs.query()` (not `getCurrent()`)

2. **Implement container-specific BroadcastChannel**
   - Change from `'quick-tabs-sync'` to `'quick-tabs-sync-' + cookieStoreId`

3. **Restructure storage to use container keys**
   - Organize state by `cookieStoreId` instead of flat array

4. **Enforce container filtering in syncFromStorage()**
   - Always pass `this.cookieStoreId` as filter
   - Never process all containers

### Phase 2: Message Isolation (Important)

**Goal:** Ensure background script and content scripts respect container
boundaries

5. **Update background script to filter message recipients**
   - Use `browser.tabs.query({ cookieStoreId })` before sending messages
   - Include `cookieStoreId` in all message payloads

6. **Add container validation to message listeners**
   - Check `message.cookieStoreId === this.cookieStoreId` before processing

7. **Filter storage event listeners by container**
   - Extract only current container's state from storage changes

### Phase 3: Panel Enhancement (Recommended)

**Goal:** Make Quick Tab Manager container-aware

8. **Detect container context when panel opens**
   - Store `this.currentContainerId` in PanelManager
   - Use `browser.tabs.query()` to detect current tab

9. **Filter panel content by container**
   - Show only Quick Tabs from current container
   - Update panel header to indicate active container

---

## Testing Strategy

### Test Case 1: Cross-Container Isolation

**Steps:**

1. Open Tab A in Firefox Container "Personal"
2. Create a Quick Tab in Tab A
3. Switch to Tab B in Firefox Container "Work"

**Expected Result:** The Quick Tab from "Personal" does NOT appear in Tab B

### Test Case 2: Within-Container Synchronization

**Steps:**

1. Open Tab A and Tab B, both in Container "Personal"
2. Create a Quick Tab in Tab A

**Expected Result:** The Quick Tab appears in both Tab A and Tab B

### Test Case 3: Panel Container Isolation

**Steps:**

1. Create 3 Quick Tabs in Container "Personal"
2. Create 5 Quick Tabs in Container "Work"
3. Open Quick Tab Manager in a tab in Container "Personal"

**Expected Result:** Panel shows only 3 Quick Tabs (not all 8)

### Test Case 4: Storage Persistence

**Steps:**

1. Create Quick Tabs in Container "Personal" and Container "Work"
2. Refresh the page

**Expected Result:** Quick Tabs restore to their correct containers

---

## Key Implementation Insights

### Why tabs.query() Instead of tabs.getCurrent()?

`browser.tabs.getCurrent()` **only works in browser UI contexts** (popup,
options page)[40]. In content scripts, it returns `undefined`. The extension's
Quick Tabs feature runs in content scripts, so it must use:

```javascript
browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  const currentTab = tabs[0];
  const cookieStoreId = currentTab.cookieStoreId;
});
```

This pattern is documented in Mozilla's examples for detecting the current tab's
container[36][38].

### Why Container-Specific BroadcastChannels?

BroadcastChannel is a simple publish-subscribe system where all listeners
receive all messages on a channel. If all tabs listen to `'quick-tabs-sync'`,
then:

- Tab in Container 1 broadcasts: "Create Quick Tab X"
- Tab in Container 2 receives the broadcast and creates Quick Tab X (WRONG)

Using container-specific channels (`'quick-tabs-sync-firefox-container-1'`):

- Tab in Container 1 broadcasts on its channel
- Tab in Container 2 listens to a different channel
- Automatic isolation without manual filtering

### Why Background Script Needs Container Filtering?

The background script has global visibility of all tabs across all
containers[15][36]. When it broadcasts Quick Tab operations, it could send to
the wrong tabs. By using:

```javascript
browser.tabs.query({ cookieStoreId: targetContainer });
```

The background script explicitly limits message recipients to the correct
container[15][36].

---

## Summary

The Firefox Container Tabs integration requires systematic changes across three
architectural layers:

1. **Detection Layer:** QuickTabsManager detects and stores its container
   context
2. **Communication Layer:** BroadcastChannel and message handlers filter by
   container
3. **Storage Layer:** State is organized by container with filtered read/write
   access

**No code currently implements container support.** All changes are new
additions to the framework. The implementation focuses on:

- Detecting container context using `browser.tabs.query()`[36]
- Creating container-specific communication channels
- Filtering storage operations by `cookieStoreId`
- Validating messages match the recipient's container

These changes ensure Quick Tabs in Container 1 remain completely isolated from
Container 2, with independent state, synchronization, and management interfaces.
