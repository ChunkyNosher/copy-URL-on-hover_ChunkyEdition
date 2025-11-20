# Firefox Container Tabs Integration for Quick Tabs

## Complete Implementation Guide v1.5.8.17+

### Document Purpose

This document provides a comprehensive implementation plan for integrating Firefox Container Tabs API into the copy-URL-on-hover extension to achieve complete Quick Tab and Quick Tab Manager isolation by container. This document is optimized for GitHub Copilot Agent implementation while remaining human-readable.

---

## Table of Contents

1. [Overview](#overview)
2. [Requirements Summary](#requirements-summary)
3. [Current vs. Desired Behavior](#current-vs-desired-behavior)
4. [Firefox Containers Technical Foundation](#firefox-containers-technical-foundation)
5. [Architecture Changes](#architecture-changes)
6. [Implementation Steps](#implementation-steps)
7. [Code Changes Required](#code-changes-required)
8. [Testing Procedures](#testing-procedures)
9. [Compatibility with Other v1.5.8.16+ Changes](#compatibility-with-other-v1-5-8-16-changes)
10. [Migration Strategy](#migration-strategy)

---

## Overview

Firefox Container Tabs allow users to separate their browsing contexts using different "containers" (e.g., Personal, Work, Shopping). Each container has a unique `cookieStoreId` and maintains completely isolated cookies, localStorage, and session data.

**Goal**: Extend Quick Tabs functionality to respect container boundaries, ensuring:

- Quick Tabs opened in Container 1 only appear in tabs within Container 1
- Quick Tab Manager shows only Quick Tabs from the current container
- Cross-tab synchronization works within containers but not across them

---

## Requirements Summary

### Requirement 1: Quick Tab Container Isolation

**User Story**: When I have a Quick Tab open in Tab A (Firefox Container 1) and switch to Tab B (Firefox Container 2), the Quick Tab from Container 1 should NOT appear in Tab B.

**Technical Translation**: Quick Tabs must be namespaced by `cookieStoreId` in storage and filtered during restoration.

### Requirement 2: Quick Tab Manager Container Filtering

**User Story**: If I have 4 Quick Tabs in Container 1 and 6 Quick Tabs in Container 2, opening the Quick Tab Manager in Container 1 should show only the 4 Quick Tabs from Container 1.

**Technical Translation**: Quick Tab Manager must query the current tab's `cookieStoreId` and filter the displayed list accordingly.

---

## Current vs. Desired Behavior

### Current Behavior (v1.5.8.16)

**Scenario**: User opens Quick Tab in Firefox Container "Personal"

1. User hovers over link in tab with `cookieStoreId: "firefox-container-1"`
2. User presses Quick Tab shortcut
3. Quick Tab is created and stored in `browser.storage.sync.quicktabs_state_v2`
4. Storage structure:

```javascript
{
  "quicktabs_state_v2": [
    {
      "id": "qt-12345",
      "url": "https://example.com",
      "left": 100,
      "top": 100,
      // NO cookieStoreId stored!
    }
  ]
}
```

5. User switches to tab in Firefox Container "Work" (`cookieStoreId: "firefox-container-2"`)
6. Extension loads ALL Quick Tabs from storage
7. **Problem**: Quick Tab from Container 1 appears in Container 2 tab ❌

### Desired Behavior (v1.5.8.17+)

**Scenario**: User opens Quick Tab in Firefox Container "Personal"

1. User hovers over link in tab with `cookieStoreId: "firefox-container-1"`
2. User presses Quick Tab shortcut
3. Extension detects current `cookieStoreId`
4. Quick Tab is created with container tracking:

```javascript
{
  "quicktabs_state_v3": {
    "firefox-default": {
      "tabs": [],
      "timestamp": 1731619200000
    },
    "firefox-container-1": {
      "tabs": [
        {
          "id": "qt-12345",
          "url": "https://example.com",
          "left": 100,
          "top": 100,
          "cookieStoreId": "firefox-container-1"
        }
      ],
      "timestamp": 1731619200000
    },
    "firefox-container-2": {
      "tabs": [],
      "timestamp": 1731619200000
    }
  }
}
```

5. User switches to tab in Firefox Container "Work" (`cookieStoreId: "firefox-container-2"`)
6. Extension loads ONLY Quick Tabs with matching `cookieStoreId: "firefox-container-2"`
7. **Result**: No Quick Tabs appear (none exist for Container 2) ✅

---

## Firefox Containers Technical Foundation

### Container Identification

Every tab in Firefox has a `cookieStoreId` property accessible via `browser.tabs.query()`:

| Container Type         | cookieStoreId Value     |
| ---------------------- | ----------------------- |
| Default (no container) | `"firefox-default"`     |
| Private Browsing       | `"firefox-private"`     |
| Container 1            | `"firefox-container-1"` |
| Container 2            | `"firefox-container-2"` |
| Container N            | `"firefox-container-N"` |

### Required Permissions

Add to `manifest.json`:

```json
{
  "permissions": ["contextualIdentities", "cookies", "tabs", "storage"]
}
```

**Note**:

- `contextualIdentities`: Enables container management
- `cookies`: Required for accessing `cookieStoreId` property
- Existing permissions `tabs` and `storage` remain unchanged

### Container Detection API

```javascript
/**
 * Get the cookieStoreId for the current active tab
 * @returns {Promise<string>} cookieStoreId (e.g., "firefox-container-1")
 */
async function getCurrentCookieStoreId() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0]?.cookieStoreId || 'firefox-default';
}
```

### Container Metadata

Get container display information:

```javascript
/**
 * Get container details for display purposes
 * @param {string} cookieStoreId
 * @returns {Promise<Object>} Container info
 */
async function getContainerInfo(cookieStoreId) {
  try {
    const container = await browser.contextualIdentities.get(cookieStoreId);
    return {
      name: container.name, // e.g., "Personal"
      color: container.color, // e.g., "blue"
      icon: container.icon, // e.g., "fingerprint"
      iconUrl: container.iconUrl // Data URL of icon
    };
  } catch (e) {
    // Default or private container
    if (cookieStoreId === 'firefox-default') {
      return { name: 'Default', color: 'gray', icon: 'circle' };
    } else if (cookieStoreId === 'firefox-private') {
      return { name: 'Private', color: 'purple', icon: 'briefcase' };
    }
    return { name: 'Unknown', color: 'gray', icon: 'circle' };
  }
}
```

### Documentation References

- [Work with contextual identities - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Work_with_contextual_identities)
- [contextualIdentities API - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities)
- [tabs.query() - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query)
- [Containers for add-on developers - Mozilla Hacks](https://hacks.mozilla.org/2017/10/containers-for-add-on-developers/)

---

## Architecture Changes

### Current Architecture (v1.5.8.16)

```
Storage Structure:
browser.storage.sync {
  quicktabs_state_v2: [
    { id, url, position, size, ... }
  ]
}

┌─────────────────────────────────────┐
│   Tab (Any Container)               │
│  ┌──────────────────────────────┐   │
│  │  Load ALL Quick Tabs from    │   │
│  │  storage                     │   │
│  │  ↓                           │   │
│  │  Display ALL Quick Tabs      │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

### New Architecture (v1.5.8.17+)

```
Storage Structure:
browser.storage.sync {
  quicktabs_state_v3: {
    "firefox-default": {
      tabs: [{ id, url, ... }],
      timestamp: ...
    },
    "firefox-container-1": {
      tabs: [{ id, url, ... }],
      timestamp: ...
    },
    "firefox-container-2": {
      tabs: [{ id, url, ... }],
      timestamp: ...
    }
  }
}

┌─────────────────────────────────────────┐
│   Tab in Container 1                    │
│  ┌──────────────────────────────────┐   │
│  │  1. Detect cookieStoreId         │   │
│  │     → "firefox-container-1"      │   │
│  │  2. Load ONLY Quick Tabs for     │   │
│  │     "firefox-container-1"        │   │
│  │  3. Display filtered Quick Tabs  │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│   Tab in Container 2                    │
│  ┌──────────────────────────────────┐   │
│  │  1. Detect cookieStoreId         │   │
│  │     → "firefox-container-2"      │   │
│  │  2. Load ONLY Quick Tabs for     │   │
│  │     "firefox-container-2"        │   │
│  │  3. Display NO Quick Tabs        │   │
│  │     (none exist for container 2) │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Foundation (Container Detection)

#### Step 1.1: Add Permissions to Manifest

**File**: `manifest.json`

Add missing permissions:

```json
{
  "permissions": ["contextualIdentities", "cookies"]
}
```

#### Step 1.2: Create Container Utility Module

**File**: `src/utils/container-utils.js` (new file)

```javascript
/**
 * Container Utilities
 * Provides helper functions for Firefox Container Tabs integration
 */

/**
 * Get the cookieStoreId of the current active tab
 * @returns {Promise<string>} cookieStoreId or "firefox-default"
 */
export async function getCurrentCookieStoreId() {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    return tabs[0]?.cookieStoreId || 'firefox-default';
  } catch (error) {
    console.error('[Container Utils] Failed to get cookieStoreId:', error);
    return 'firefox-default';
  }
}

/**
 * Get container information for display
 * @param {string} cookieStoreId
 * @returns {Promise<Object>} Container metadata
 */
export async function getContainerInfo(cookieStoreId) {
  // Handle default and private containers
  if (cookieStoreId === 'firefox-default') {
    return {
      name: 'Default',
      color: '#7c7c7d',
      icon: 'circle',
      cookieStoreId: 'firefox-default'
    };
  }

  if (cookieStoreId === 'firefox-private') {
    return {
      name: 'Private',
      color: '#9400ff',
      icon: 'briefcase',
      cookieStoreId: 'firefox-private'
    };
  }

  // Query contextualIdentities API for container details
  try {
    const container = await browser.contextualIdentities.get(cookieStoreId);
    return {
      name: container.name,
      color: container.color,
      icon: container.icon,
      iconUrl: container.iconUrl,
      cookieStoreId: container.cookieStoreId
    };
  } catch (error) {
    console.error('[Container Utils] Failed to get container info:', error);
    return {
      name: 'Unknown',
      color: '#7c7c7d',
      icon: 'circle',
      cookieStoreId: cookieStoreId
    };
  }
}

/**
 * Check if containers feature is enabled
 * @returns {Promise<boolean>}
 */
export async function isContainersEnabled() {
  try {
    await browser.contextualIdentities.query({});
    return true;
  } catch (error) {
    console.warn('[Container Utils] Containers not enabled:', error);
    return false;
  }
}

/**
 * Get all available containers
 * @returns {Promise<Array>} List of container objects
 */
export async function getAllContainers() {
  try {
    const containers = await browser.contextualIdentities.query({});

    // Always include default container
    const all = [
      {
        name: 'Default',
        color: '#7c7c7d',
        icon: 'circle',
        cookieStoreId: 'firefox-default'
      },
      ...containers
    ];

    return all;
  } catch (error) {
    console.error('[Container Utils] Failed to get all containers:', error);
    return [
      {
        name: 'Default',
        color: '#7c7c7d',
        icon: 'circle',
        cookieStoreId: 'firefox-default'
      }
    ];
  }
}
```

**Import in content.js**:

```javascript
import {
  getCurrentCookieStoreId,
  getContainerInfo,
  isContainersEnabled
} from './utils/container-utils.js';
```

---

### Phase 2: Container-Aware State Management

#### Step 2.1: Update State Schema

**File**: `src/core/state.js`

Change the storage key and structure:

**Before** (v1.5.8.16):

```javascript
const STATE_KEY = 'quicktabs_state_v2';

// Storage structure:
// {
//   quicktabs_state_v2: [
//     { id, url, ... }
//   ]
// }
```

**After** (v1.5.8.17+):

```javascript
const STATE_KEY = 'quicktabs_state_v3';

// Storage structure:
// {
//   quicktabs_state_v3: {
//     "firefox-default": {
//       tabs: [ { id, url, cookieStoreId, ... } ],
//       timestamp: 1731619200000
//     },
//     "firefox-container-1": {
//       tabs: [ { id, url, cookieStoreId, ... } ],
//       timestamp: 1731619200000
//     }
//   }
// }
```

#### Step 2.2: Create Container-Aware State Manager

**File**: `src/core/container-state-manager.js` (new file)

```javascript
/**
 * Container-Aware Quick Tab State Manager
 * Manages Quick Tab state with container isolation
 */

import { getCurrentCookieStoreId } from '../utils/container-utils.js';

const STATE_KEY = 'quicktabs_state_v3';

export class ContainerStateManager {
  constructor() {
    this.stateKey = STATE_KEY;
  }

  /**
   * Save Quick Tabs for the current container
   * @param {Array} quickTabsData - Array of Quick Tab objects
   */
  async saveQuickTabs(quickTabsData) {
    const cookieStoreId = await getCurrentCookieStoreId();

    // Retrieve entire state object
    const result = await browser.storage.sync.get(this.stateKey);
    const allContainerStates = result[this.stateKey] || {};

    // Update state for current container
    allContainerStates[cookieStoreId] = {
      tabs: quickTabsData.map(tab => ({
        ...tab,
        cookieStoreId: cookieStoreId // Ensure cookieStoreId is always set
      })),
      timestamp: Date.now()
    };

    // Save back to storage
    await browser.storage.sync.set({
      [this.stateKey]: allContainerStates
    });

    console.log(`[Container State] Saved ${quickTabsData.length} Quick Tabs for ${cookieStoreId}`);
  }

  /**
   * Load Quick Tabs for the current container only
   * @returns {Promise<Array>} Array of Quick Tab objects
   */
  async loadQuickTabs() {
    const cookieStoreId = await getCurrentCookieStoreId();

    const result = await browser.storage.sync.get(this.stateKey);
    const allContainerStates = result[this.stateKey] || {};

    const containerState = allContainerStates[cookieStoreId];

    if (!containerState || !containerState.tabs) {
      console.log(`[Container State] No Quick Tabs found for ${cookieStoreId}`);
      return [];
    }

    console.log(
      `[Container State] Loaded ${containerState.tabs.length} Quick Tabs for ${cookieStoreId}`
    );
    return containerState.tabs || [];
  }

  /**
   * Get Quick Tabs for ALL containers (for manager display)
   * @returns {Promise<Object>} Object keyed by cookieStoreId
   */
  async loadAllContainerStates() {
    const result = await browser.storage.sync.get(this.stateKey);
    return result[this.stateKey] || {};
  }

  /**
   * Clear Quick Tabs for the current container
   */
  async clearCurrentContainer() {
    const cookieStoreId = await getCurrentCookieStoreId();

    const result = await browser.storage.sync.get(this.stateKey);
    const allContainerStates = result[this.stateKey] || {};

    allContainerStates[cookieStoreId] = {
      tabs: [],
      timestamp: Date.now()
    };

    await browser.storage.sync.set({
      [this.stateKey]: allContainerStates
    });

    console.log(`[Container State] Cleared Quick Tabs for ${cookieStoreId}`);
  }

  /**
   * Remove a specific Quick Tab from the current container
   * @param {string} quickTabId - ID of Quick Tab to remove
   */
  async removeQuickTab(quickTabId) {
    const cookieStoreId = await getCurrentCookieStoreId();

    const result = await browser.storage.sync.get(this.stateKey);
    const allContainerStates = result[this.stateKey] || {};

    if (!allContainerStates[cookieStoreId]) {
      return;
    }

    allContainerStates[cookieStoreId].tabs = allContainerStates[cookieStoreId].tabs.filter(
      tab => tab.id !== quickTabId
    );
    allContainerStates[cookieStoreId].timestamp = Date.now();

    await browser.storage.sync.set({
      [this.stateKey]: allContainerStates
    });

    console.log(`[Container State] Removed Quick Tab ${quickTabId} from ${cookieStoreId}`);
  }

  /**
   * Get Quick Tab count for current container
   * @returns {Promise<number>}
   */
  async getQuickTabCount() {
    const tabs = await this.loadQuickTabs();
    return tabs.length;
  }

  /**
   * Get Quick Tab count for all containers combined
   * @returns {Promise<number>}
   */
  async getTotalQuickTabCount() {
    const allStates = await this.loadAllContainerStates();
    let total = 0;

    for (const containerId in allStates) {
      total += allStates[containerId].tabs?.length || 0;
    }

    return total;
  }
}

// Export singleton instance
export const containerStateManager = new ContainerStateManager();
```

#### Step 2.3: Integrate Container State Manager

**File**: `src/content.js` or wherever Quick Tabs are managed

**Import**:

```javascript
import { containerStateManager } from './core/container-state-manager.js';
import { getCurrentCookieStoreId } from './utils/container-utils.js';
```

**Replace all state operations**:

**Before**:

```javascript
// Loading Quick Tabs
const allQuickTabs = await StateManager.loadQuickTabs();

// Saving Quick Tabs
await StateManager.saveQuickTabs(quickTabsArray);
```

**After**:

```javascript
// Loading Quick Tabs (only for current container)
const containerQuickTabs = await containerStateManager.loadQuickTabs();

// Saving Quick Tabs (only for current container)
await containerStateManager.saveQuickTabs(quickTabsArray);
```

---

### Phase 3: Container-Aware BroadcastChannel

Currently, BroadcastChannel synchronizes Quick Tab state across ALL tabs. We need to filter messages by `cookieStoreId`.

#### Step 3.1: Add Container ID to Broadcast Messages

**File**: `src/content.js` or Quick Tab management module

**Before**:

```javascript
// Broadcasting Quick Tab creation
quickTabsBroadcast.postMessage({
  type: 'CREATE',
  data: {
    id: quickTab.id,
    url: quickTab.url,
    left: quickTab.left,
    top: quickTab.top
  }
});
```

**After**:

```javascript
// Broadcasting Quick Tab creation with container ID
const cookieStoreId = await getCurrentCookieStoreId();

quickTabsBroadcast.postMessage({
  type: 'CREATE',
  cookieStoreId: cookieStoreId, // NEW: Include container ID
  data: {
    id: quickTab.id,
    url: quickTab.url,
    left: quickTab.left,
    top: quickTab.top,
    cookieStoreId: cookieStoreId // Also in data for consistency
  }
});
```

#### Step 3.2: Filter Incoming Broadcast Messages

**File**: `src/content.js` or Quick Tab management module

**Before**:

```javascript
quickTabsBroadcast.addEventListener('message', event => {
  const { type, data } = event.data;

  if (type === 'CREATE') {
    createQuickTabFromBroadcast(data);
  }
  // ... handle other types
});
```

**After**:

```javascript
quickTabsBroadcast.addEventListener('message', async event => {
  const { type, cookieStoreId, data } = event.data;

  // FILTER: Ignore broadcasts from different containers
  const currentCookieStoreId = await getCurrentCookieStoreId();

  if (cookieStoreId !== currentCookieStoreId) {
    console.log(
      `[Broadcast] Ignoring message from ${cookieStoreId} (current: ${currentCookieStoreId})`
    );
    return; // Ignore messages from other containers
  }

  // Process message if container matches
  if (type === 'CREATE') {
    createQuickTabFromBroadcast(data);
  }
  // ... handle other types
});
```

**Apply this pattern to ALL broadcast message types**:

- `CREATE`
- `UPDATE`
- `MOVE`
- `RESIZE`
- `MINIMIZE`
- `RESTORE`
- `CLOSE`
- `PIN`
- `UNPIN`

---

### Phase 4: Quick Tab Manager Container Filtering

#### Step 4.1: Update Manager to Show Current Container Only

**File**: `src/ui/quick-tabs-manager.js` or equivalent

**Add container detection to manager initialization**:

```javascript
class QuickTabsManager {
  async initialize() {
    // Detect current container
    this.cookieStoreId = await getCurrentCookieStoreId();
    this.containerInfo = await getContainerInfo(this.cookieStoreId);

    // Load Quick Tabs for this container ONLY
    this.quickTabs = await containerStateManager.loadQuickTabs();

    // Render UI
    this.render();

    // Listen for storage changes
    browser.storage.onChanged.addListener(this.handleStorageChange.bind(this));
  }

  async render() {
    // Clear existing content
    this.container.innerHTML = '';

    // Show container badge/header
    this.renderContainerHeader();

    // Show Quick Tabs list
    if (this.quickTabs.length === 0) {
      this.renderEmptyState();
    } else {
      this.renderQuickTabsList();
    }
  }

  renderContainerHeader() {
    const header = document.createElement('div');
    header.className = 'manager-container-header';
    header.innerHTML = `
      <div class="container-badge" style="background-color: ${this.containerInfo.color}">
        <span class="container-icon">${this.containerInfo.icon}</span>
        <span class="container-name">${this.containerInfo.name}</span>
      </div>
      <div class="container-stats">
        ${this.quickTabs.length} Quick Tab${this.quickTabs.length !== 1 ? 's' : ''}
      </div>
    `;
    this.container.appendChild(header);
  }

  renderEmptyState() {
    const emptyState = document.createElement('div');
    emptyState.className = 'manager-empty-state';

    // Get user's configured Quick Tab shortcut
    const shortcut = await this.getQuickTabShortcut();

    emptyState.innerHTML = `
      <p>No Quick Tabs in this container.</p>
      <p class="hint">Press <kbd>${shortcut}</kbd> while hovering over a link to create one.</p>
    `;
    this.container.appendChild(emptyState);
  }

  async getQuickTabShortcut() {
    // Fetch from settings or use default
    const settings = await browser.storage.sync.get('quickTabShortcut');
    const shortcut = settings.quickTabShortcut || { key: 'q', ctrl: false, alt: false, shift: false };

    return this.formatShortcut(shortcut);
  }

  formatShortcut(shortcut) {
    const parts = [];
    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.alt) parts.push('Alt');
    if (shortcut.shift) parts.push('Shift');
    parts.push(shortcut.key.toUpperCase());
    return parts.join('+');
  }

  handleStorageChange(changes, areaName) {
    if (areaName === 'sync' && changes.quicktabs_state_v3) {
      // Reload Quick Tabs for current container
      this.reloadQuickTabs();
    }
  }

  async reloadQuickTabs() {
    this.quickTabs = await containerStateManager.loadQuickTabs();
    this.render();
  }
}
```

#### Step 4.2: Add "Show All Containers" Toggle (Optional Enhancement)

Allow users to optionally view Quick Tabs from all containers with visual distinction:

```javascript
class QuickTabsManager {
  constructor() {
    this.showAllContainers = false;  // Default: show current container only
  }

  async toggleShowAllContainers() {
    this.showAllContainers = !this.showAllContainers;

    if (this.showAllContainers) {
      this.allContainerStates = await containerStateManager.loadAllContainerStates();
    } else {
      this.quickTabs = await containerStateManager.loadQuickTabs();
    }

    this.render();
  }

  renderQuickTabsList() {
    if (this.showAllContainers) {
      this.renderAllContainersView();
    } else {
      this.renderCurrentContainerView();
    }
  }

  renderAllContainersView() {
    // Group Quick Tabs by container
    for (const containerId in this.allContainerStates) {
      const containerState = this.allContainerStates[containerId];
      const containerInfo = await getContainerInfo(containerId);

      const section = document.createElement('div');
      section.className = 'container-section';
      section.innerHTML = `
        <h3 class="container-section-header">
          <span class="container-badge" style="background-color: ${containerInfo.color}">
            ${containerInfo.name}
          </span>
          <span class="container-count">${containerState.tabs.length} tabs</span>
        </h3>
        <div class="container-tabs">
          ${this.renderTabsList(containerState.tabs, containerId)}
        </div>
      `;

      this.container.appendChild(section);
    }
  }
}
```

---

### Phase 5: Quick Tab Creation with Container Tracking

#### Step 5.1: Ensure cookieStoreId is Captured on Creation

**File**: Quick Tab creation function

**Before**:

```javascript
function createQuickTab(url, position) {
  const quickTab = {
    id: `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    url: url,
    left: position.left,
    top: position.top,
    width: 800,
    height: 600,
    title: 'Quick Tab',
    minimized: false,
    pinnedToUrl: null
  };

  return quickTab;
}
```

**After**:

```javascript
async function createQuickTab(url, position) {
  const cookieStoreId = await getCurrentCookieStoreId();

  const quickTab = {
    id: `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    url: url,
    left: position.left,
    top: position.top,
    width: 800,
    height: 600,
    title: 'Quick Tab',
    cookieStoreId: cookieStoreId, // NEW: Track container
    minimized: false,
    pinnedToUrl: null
  };

  console.log(`[Quick Tab] Created in container ${cookieStoreId}`);
  return quickTab;
}
```

---

### Phase 6: Storage Change Listener Updates

Update storage listeners to handle the new v3 schema:

**File**: `src/content.js` or background script

**Before**:

```javascript
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.quicktabs_state_v2) {
    // Reload all Quick Tabs
    reloadQuickTabs();
  }
});
```

**After**:

```javascript
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'sync' && changes.quicktabs_state_v3) {
    const currentCookieStoreId = await getCurrentCookieStoreId();

    // Check if our container's state changed
    const oldState = changes.quicktabs_state_v3.oldValue || {};
    const newState = changes.quicktabs_state_v3.newValue || {};

    const oldContainerState = oldState[currentCookieStoreId];
    const newContainerState = newState[currentCookieStoreId];

    if (JSON.stringify(oldContainerState) !== JSON.stringify(newContainerState)) {
      console.log(`[Storage] Container ${currentCookieStoreId} state changed, reloading`);
      reloadQuickTabs();
    } else {
      console.log(`[Storage] Change in other container, ignoring`);
    }
  }
});
```

---

## Code Changes Required

### Summary Table

| File                                  | Change Type | Lines Added | Lines Modified | Description                                          |
| ------------------------------------- | ----------- | ----------- | -------------- | ---------------------------------------------------- |
| `manifest.json`                       | Update      | 2           | 0              | Add `contextualIdentities` and `cookies` permissions |
| `src/utils/container-utils.js`        | New File    | 120         | 0              | Container detection and info utilities               |
| `src/core/container-state-manager.js` | New File    | 180         | 0              | Container-aware state management                     |
| `src/content.js`                      | Update      | 50          | 80             | Integrate container detection and filtering          |
| `src/ui/quick-tabs-manager.js`        | Update      | 100         | 60             | Container-specific manager view                      |
| `background.js`                       | Update      | 20          | 30             | Update message handling for containers               |
| **Total**                             | -           | **472**     | **170**        | **~640 lines total**                                 |

---

## Testing Procedures

### Test Suite 1: Basic Container Isolation

**Test 1.1**: Create Quick Tab in Container 1

1. Open tab in Firefox Container "Personal" (Container 1)
2. Navigate to https://example.com
3. Hover over a link
4. Press Q (or configured Quick Tab shortcut)
5. **Expected**: Quick Tab opens successfully
6. **Verify**: Quick Tab has `cookieStoreId: "firefox-container-1"`

**Test 1.2**: Switch to Container 2

1. With Quick Tab still open from Test 1.1
2. Switch to a tab in Firefox Container "Work" (Container 2)
3. **Expected**: Quick Tab from Container 1 does NOT appear
4. **Verify**: No Quick Tabs visible in Container 2 tab

**Test 1.3**: Return to Container 1

1. Switch back to the tab in Container 1
2. **Expected**: Quick Tab from Test 1.1 is still visible
3. **Expected**: Quick Tab position and size unchanged

---

### Test Suite 2: Quick Tab Manager Container Filtering

**Test 2.1**: Manager Shows Only Current Container

1. Create 3 Quick Tabs in Container "Personal"
2. Create 2 Quick Tabs in Container "Work"
3. Open Quick Tab Manager in a tab within Container "Personal"
4. **Expected**: Manager shows exactly 3 Quick Tabs
5. **Expected**: Container header displays "Personal" with appropriate color/icon

**Test 2.2**: Manager Updates When Switching Containers

1. With Manager open from Test 2.1
2. Switch to a tab in Container "Work"
3. Open Quick Tab Manager
4. **Expected**: Manager shows exactly 2 Quick Tabs
5. **Expected**: Container header updates to "Work"

**Test 2.3**: Empty State Message Shows Correct Shortcut

1. Open Quick Tab Manager in a container with no Quick Tabs
2. **Expected**: Message displays "Press [SHORTCUT] while hovering over a link"
3. Change Quick Tab shortcut in settings (e.g., to Ctrl+E)
4. **Expected**: Message updates to "Press Ctrl+E while hovering over a link"

---

### Test Suite 3: BroadcastChannel Container Filtering

**Test 3.1**: Same Container Cross-Tab Sync

1. Open two tabs (Tab A and Tab B) in Container "Personal"
2. Create Quick Tab in Tab A
3. **Expected**: Quick Tab appears in Tab B (same container sync works)

**Test 3.2**: Different Container Isolation

1. Open Tab C in Container "Work"
2. With Quick Tab from Test 3.1 still in Container "Personal"
3. **Expected**: Quick Tab does NOT appear in Tab C (different container)

**Test 3.3**: Broadcast Filtering Logs

1. Open browser console
2. Create Quick Tab in Container 1
3. Switch to tab in Container 2
4. **Expected**: Console shows "[Broadcast] Ignoring message from firefox-container-1"

---

### Test Suite 4: Migration from v1.5.8.16

**Test 4.1**: Automatic Migration

1. Install v1.5.8.16 with existing Quick Tabs
2. Create 5 Quick Tabs
3. Upgrade to v1.5.8.17+
4. **Expected**: Migration script runs automatically
5. **Expected**: All 5 Quick Tabs now under `firefox-default` container
6. **Expected**: No data loss

**Test 4.2**: Migration Preserves All Properties

1. After migration from Test 4.1
2. Verify each Quick Tab retains:
   - Original URL
   - Position (left, top)
   - Size (width, height)
   - Minimized state
   - Pinned URL (if any)
3. **Expected**: All properties intact

---

### Test Suite 5: Edge Cases

**Test 5.1**: Default Container Behavior

1. Open tab in default container (no container assigned)
2. Create Quick Tab
3. **Expected**: Quick Tab has `cookieStoreId: "firefox-default"`
4. **Expected**: Behaves identically to container tabs

**Test 5.2**: Private Browsing Container

1. Open private browsing window
2. Create Quick Tab
3. **Expected**: Quick Tab has `cookieStoreId: "firefox-private"`
4. **Expected**: Isolated from normal containers

**Test 5.3**: Container Deletion Handling

1. Create 3 Quick Tabs in a custom container (e.g., "Shopping")
2. Delete the "Shopping" container via Firefox settings
3. Reopen extension
4. **Expected**: Orphaned Quick Tabs remain in storage (graceful degradation)
5. **Expected**: Manager shows "Unknown" container for orphaned tabs

---

## Compatibility with Other v1.5.8.16+ Changes

This implementation must integrate smoothly with the following features documented in the "v1.5.8.16 issues docs" folder:

### Integration Point 1: Quick Tab Flash Fix

**Document**: `quick-tab-bugs-fixes.md` (from current conversation)

**Compatibility Check**:

- ✅ Container isolation does NOT conflict with flash fix
- ✅ Both features operate at different layers:
  - Flash fix: DOM positioning timing
  - Container isolation: Data storage and filtering

**Code Coordination**:

- Container detection happens BEFORE Quick Tab creation
- Flash fix applies AFTER position calculation
- No shared code paths

### Integration Point 2: Notification System Customization

**Document**: `quick-tab-bugs-fixes.md` (from current conversation)

**Compatibility Check**:

- ✅ Container isolation does NOT conflict with notification system
- ⚠️ **Enhancement Opportunity**: Add container name to notification text

**Suggested Enhancement**:

```javascript
// When creating Quick Tab
const containerInfo = await getContainerInfo(cookieStoreId);
showNotification(
  `Quick Tab created in ${containerInfo.name} container!`,
  NOTIFICATION_CONFIGS.quickTabOpened
);
```

### Integration Point 3: Color Picker Fix

**Document**: `quick-tab-bugs-fixes.md` (from current conversation)

**Compatibility Check**:

- ✅ No conflicts - completely separate feature
- Container isolation affects runtime behavior
- Color picker affects settings UI

### Integration Point 4: Dynamic Shortcut Display

**Document**: `quick-tab-bugs-fixes.md` (from current conversation)

**Compatibility Check**:

- ✅ Already integrated in this document (see Phase 4.1)
- Empty state message now shows correct shortcut AND container name

### Integration Point 5: Zen Browser Split View

**If documented in v1.5.8.16 issues docs folder**:

**Compatibility Check**:

- ⚠️ **Requires Coordination**: Both features filter Quick Tab visibility
- Split View filters by browser pane
- Container isolation filters by cookieStoreId

**Resolution Strategy**:

```javascript
// Combined filtering logic
async function shouldShowQuickTab(quickTab) {
  // Filter 1: Container isolation
  const currentCookieStoreId = await getCurrentCookieStoreId();
  if (quickTab.cookieStoreId !== currentCookieStoreId) {
    return false;
  }

  // Filter 2: Split View isolation (if enabled)
  if (isZenBrowserSplitView()) {
    const splitPaneId = await getCurrentSplitPaneId();
    if (quickTab.splitPaneId !== splitPaneId) {
      return false;
    }
  }

  return true;
}
```

---

## Migration Strategy

### Migration Script

**Purpose**: Convert existing v2 state to v3 container-aware format

**File**: `src/core/migration.js` (new file)

```javascript
/**
 * Migrate Quick Tabs from v2 (global) to v3 (container-aware)
 * All existing Quick Tabs will be moved to "firefox-default" container
 */

const OLD_STATE_KEY = 'quicktabs_state_v2';
const NEW_STATE_KEY = 'quicktabs_state_v3';

export async function migrateToContainerAwareState() {
  console.log('[Migration] Starting migration from v2 to v3...');

  // Check if already migrated
  const existingV3 = await browser.storage.sync.get(NEW_STATE_KEY);
  if (existingV3[NEW_STATE_KEY]) {
    console.log('[Migration] Already migrated to v3, skipping.');
    return;
  }

  // Load v2 state
  const oldStateResult = await browser.storage.sync.get(OLD_STATE_KEY);
  const oldQuickTabs = oldStateResult[OLD_STATE_KEY] || [];

  if (oldQuickTabs.length === 0) {
    console.log('[Migration] No Quick Tabs to migrate.');

    // Initialize empty v3 state
    await browser.storage.sync.set({
      [NEW_STATE_KEY]: {
        'firefox-default': {
          tabs: [],
          timestamp: Date.now()
        }
      }
    });

    return;
  }

  // Migrate all tabs to "firefox-default" container
  const migratedState = {
    'firefox-default': {
      tabs: oldQuickTabs.map(tab => ({
        ...tab,
        cookieStoreId: 'firefox-default' // Assign default container
      })),
      timestamp: Date.now()
    }
  };

  // Save v3 state
  await browser.storage.sync.set({
    [NEW_STATE_KEY]: migratedState
  });

  console.log(
    `[Migration] Migrated ${oldQuickTabs.length} Quick Tabs to firefox-default container.`
  );

  // Optional: Remove v2 state to free storage space
  // await browser.storage.sync.remove(OLD_STATE_KEY);
}
```

**Execution**: Run migration on extension startup

**File**: `background.js` or `src/content.js`

```javascript
import { migrateToContainerAwareState } from './core/migration.js';

// On extension install/update
browser.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'install' || details.reason === 'update') {
    console.log('[Extension] Performing migration check...');
    await migrateToContainerAwareState();
  }
});

// Also run on extension startup (in case migration was interrupted)
migrateToContainerAwareState();
```

### Rollback Plan

If container isolation causes issues:

1. **Emergency Disable Flag**:

```javascript
// Add to settings
const CONTAINER_ISOLATION_ENABLED = await browser.storage.sync.get('containerIsolationEnabled');
if (!CONTAINER_ISOLATION_ENABLED) {
  // Fall back to v2 behavior
  useGlobalStateManager();
}
```

2. **Reverse Migration Script**:

```javascript
export async function revertToGlobalState() {
  const v3State = await browser.storage.sync.get(NEW_STATE_KEY);
  const allContainerStates = v3State[NEW_STATE_KEY] || {};

  // Flatten all containers into single array
  const allQuickTabs = [];
  for (const containerId in allContainerStates) {
    allQuickTabs.push(...allContainerStates[containerId].tabs);
  }

  await browser.storage.sync.set({
    [OLD_STATE_KEY]: allQuickTabs
  });
}
```

---

## Performance Considerations

### Storage Size Impact

**Before** (v2):

```javascript
// ~100 bytes per Quick Tab × 10 tabs = 1KB
{ quicktabs_state_v2: [ ... 10 tabs ... ] }
```

**After** (v3):

```javascript
// ~100 bytes per Quick Tab × 10 tabs × 5 containers = 5KB
// Plus container metadata overhead: ~1KB
// Total: ~6KB
{
  quicktabs_state_v3: {
    "firefox-default": { tabs: [...], timestamp: ... },
    "firefox-container-1": { tabs: [...], timestamp: ... },
    "firefox-container-2": { tabs: [...], timestamp: ... },
    "firefox-container-3": { tabs: [...], timestamp: ... },
    "firefox-container-4": { tabs: [...], timestamp: ... }
  }
}
```

**Impact**: Negligible (browser.storage.sync has 100KB limit per extension)

### Computation Overhead

**Container Detection**: ~1-2ms per operation (async tab query)

**Optimization**: Cache `cookieStoreId` at tab activation:

```javascript
let cachedCookieStoreId = null;

browser.tabs.onActivated.addListener(async () => {
  cachedCookieStoreId = await getCurrentCookieStoreId();
});
```

---

## Browser Compatibility

| Browser         | Containers Support | Implementation Notes            |
| --------------- | ------------------ | ------------------------------- |
| **Firefox**     | ✅ Full Support    | Native contextualIdentities API |
| **Firefox ESR** | ✅ Full Support    | Since Firefox 60+               |
| **Chrome/Edge** | ❌ Not Supported   | No container tabs feature       |
| **Zen Browser** | ✅ Full Support    | Firefox-based, inherits support |

### Graceful Degradation for Non-Firefox Browsers

```javascript
// Detect if containers are available
const hasContainers = typeof browser.contextualIdentities !== 'undefined';

if (!hasContainers) {
  console.warn('[Containers] Not supported, falling back to global state');
  // Use old v2 state manager
  return globalStateManager;
} else {
  // Use new v3 container-aware state manager
  return containerStateManager;
}
```

---

## Accessibility

### Screen Reader Support

Add ARIA labels to container badges:

```html
<div class="container-badge" aria-label="Container: Personal" style="background-color: blue">
  <span class="container-icon">🔹</span>
  <span class="container-name">Personal</span>
</div>
```

### Keyboard Navigation

Ensure container selection is keyboard accessible:

```javascript
containerBadge.setAttribute('tabindex', '0');
containerBadge.addEventListener('keypress', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    toggleShowAllContainers();
  }
});
```

---

## Security Considerations

### Container Isolation Integrity

- Quick Tabs MUST respect container boundaries to prevent data leakage
- Never allow cross-container Quick Tab access
- Validate `cookieStoreId` on every operation

### XSS Prevention

```javascript
// Always sanitize container names from API
function sanitizeContainerName(name) {
  const div = document.createElement('div');
  div.textContent = name;
  return div.innerHTML;
}
```

---

## Future Enhancements

### Enhancement 1: Cross-Container Quick Tab Transfer

Allow users to explicitly move Quick Tabs between containers:

```javascript
async function transferQuickTab(quickTabId, targetCookieStoreId) {
  const sourceCookieStoreId = await getCurrentCookieStoreId();

  // Remove from source container
  await containerStateManager.removeQuickTab(quickTabId);

  // Add to target container
  const quickTab = { ...originalQuickTab, cookieStoreId: targetCookieStoreId };
  await containerStateManager.saveQuickTabToContainer(quickTab, targetCookieStoreId);
}
```

### Enhancement 2: Container-Specific Settings

Different Quick Tab behaviors per container:

```javascript
{
  containerSettings: {
    "firefox-container-1": {
      autoClose: true,
      defaultWidth: 1000,
      defaultHeight: 800
    },
    "firefox-container-2": {
      autoClose: false,
      defaultWidth: 600,
      defaultHeight: 400
    }
  }
}
```

### Enhancement 3: Visual Container Indicators

Show container color on Quick Tab border:

```javascript
const containerInfo = await getContainerInfo(quickTab.cookieStoreId);
quickTabElement.style.borderColor = containerInfo.color;
quickTabElement.style.borderWidth = '3px';
```

---

## Conclusion

This implementation provides complete Firefox Container Tabs isolation for Quick Tabs while maintaining backward compatibility and all existing functionality. The modular architecture allows for incremental implementation and easy testing of each component.

**Estimated Development Time**: 12-16 hours

- Phase 1-2: 4 hours
- Phase 3-4: 4 hours
- Phase 5-6: 2 hours
- Testing: 3 hours
- Documentation: 1 hour
- Buffer: 2-4 hours

**Priority**: Medium-High (enhances privacy and UX for container users)

**Risk**: Low (isolated changes, migration script in place, rollback available)

---

_Document Version: 1.0_  
_Last Updated: 2025-11-15_  
_Target Version: v1.5.8.17+_  
_Compatibility: Firefox 60+, Zen Browser_
