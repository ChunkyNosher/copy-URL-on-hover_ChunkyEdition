# Firefox Sidebar API Implementation for Quick Tabs Manager

**Document Version:** 1.0.0  
**Target Extension Version:** 1.5.8+  
**Last Updated:** 2025-11-11  
**Optimized for:** GitHub Copilot Agent & Human Developers

---

## Executive Summary

This document provides a comprehensive, step-by-step implementation guide for **replacing the current in-content minimized Quick Tabs menu** with the **Firefox Sidebar API**. The sidebar will serve as a persistent Quick Tabs manager that displays both minimized and active Quick Tabs, organized by Firefox Container Tab, with additional management features.

### Key Changes Overview

- **Remove:** Floating minimized Quick Tabs manager (`div.copy-url-minimized-manager`)
- **Add:** Firefox Sidebar panel (`sidebar/quick-tabs-manager.html`) 
- **Integrate:** Firefox Container Tab categorization with visual indicators
- **Add:** Two action buttons (Close Minimized, Close All)
- **Add:** "Go to Tab" button for active Quick Tabs
- **Fix:** All issues from "Minimized Quick Tab Manager Thread #1"

---

## Table of Contents

1. [Background & Context](#1-background--context)
2. [Architecture Overview](#2-architecture-overview)
3. [Implementation Steps](#3-implementation-steps)
4. [File Changes](#4-file-changes)
5. [Container Tab Integration](#5-container-tab-integration)
6. [UI/UX Specifications](#6-uiux-specifications)
7. [Testing & Validation](#7-testing--validation)
8. [Migration Notes](#8-migration-notes)

---

## 1. Background & Context

### Current Implementation (v1.5.7)

The extension currently uses a **floating div** positioned at the bottom-left corner to manage minimized Quick Tabs:

```javascript
// content.js - Current minimized manager (to be REPLACED)
function updateMinimizedTabsManager() {
  let manager = document.querySelector('.copy-url-minimized-manager');
  
  if (minimizedQuickTabs.length === 0) {
    if (manager) {
      manager.remove();
    }
    return;
  }
  
  if (!manager) {
    manager = document.createElement('div');
    manager.className = 'copy-url-minimized-manager';
    manager.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      ...
    `;
    document.documentElement.appendChild(manager);
  }
  // ... rest of implementation
}
```

**Problems with Current Approach:**
1. Manager recreated separately in each tab's DOM → state sync issues
2. Disappears when switching tabs (must be recreated)
3. No Firefox Container Tab awareness
4. Position loss when Quick Tab is minimized from different location
5. No integration with pinned Quick Tab functionality

### Target Implementation (v1.5.8+)

Replace floating div with **Firefox Sidebar API** (`sidebar_action` in `manifest.json`):

```json
// manifest.json - Already exists but panel.html needs to be repurposed
"sidebar_action": {
  "default_panel": "sidebar/panel.html",
  "default_title": "Quick Tabs Manager",
  "default_icon": "icons/icon.png"
}
```

**Advantages:**
- ✅ ONE instance shared across ALL tabs in the window
- ✅ Native Firefox UI persistence
- ✅ No cross-tab sync complexity (single DOM instance)
- ✅ Easy integration with Container Tabs API
- ✅ Keyboard shortcut support for toggle

---

## 2. Architecture Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     CONTENT SCRIPT                          │
│  (content.js - Each Tab Instance)                          │
│                                                             │
│  ┌──────────────────┐      ┌──────────────────┐           │
│  │ Quick Tab Window │      │ Minimized Array  │           │
│  │ (Active)         │      │ (Local)          │           │
│  └────────┬─────────┘      └────────┬─────────┘           │
│           │                         │                      │
│           │ Minimize/Close          │ Restore/Delete       │
│           ▼                         ▼                      │
│  ┌─────────────────────────────────────────────┐          │
│  │    browser.storage.sync (Container-Keyed)   │          │
│  │    Key: quick_tabs_state_v2                 │          │
│  │    {                                         │          │
│  │      "firefox-container-1": {                │          │
│  │        tabs: [...]                           │          │
│  │      },                                      │          │
│  │      "firefox-default": { ... }              │          │
│  │    }                                         │          │
│  └──────────────────┬──────────────────────────┘          │
│                     │                                      │
└─────────────────────┼──────────────────────────────────────┘
                      │
                      │ storage.onChanged
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  SIDEBAR PANEL                              │
│  (sidebar/quick-tabs-manager.html - ONE Instance)          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Listen: storage.onChanged                    │  │
│  │         Render: All Quick Tabs from ALL containers   │  │
│  │         Actions: Restore, Close, Go to Tab           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Display Format:                                           │
│  ┌────────────────────────────────────────────┐            │
│  │ 📁 Personal Container (3 tabs)             │            │
│  │   🟢 Active: YouTube Video (Tab 2)         │            │
│  │   🟡 Minimized: GitHub Repo                │            │
│  │   🟡 Minimized: Wikipedia Article          │            │
│  │                                             │            │
│  │ 📁 Work Container (1 tab)                  │            │
│  │   🟢 Active: Slack Workspace (Tab 5)       │            │
│  │                                             │            │
│  │ 📁 Default Container (0 tabs)              │            │
│  │   (No Quick Tabs)                          │            │
│  └────────────────────────────────────────────┘            │
│                                                             │
│  [ Close Minimized Tabs ]  [ Close All Tabs ]              │
└─────────────────────────────────────────────────────────────┘
```

### Container-Keyed Storage Schema

```javascript
// browser.storage.sync structure (NEW - v1.5.8)
{
  "quick_tabs_state_v2": {
    "firefox-container-1": {  // Personal Container
      "tabs": [
        {
          "id": "qt_1699...",
          "url": "https://youtube.com/watch?v=...",
          "title": "Video Title",
          "left": 100,
          "top": 100,
          "width": 800,
          "height": 600,
          "minimized": false,  // Active
          "pinnedToUrl": null,
          "slotNumber": 1,
          "activeTabId": 123  // NEW: Which browser tab contains this Quick Tab
        },
        {
          "id": "qt_1700...",
          "url": "https://github.com/...",
          "title": "GitHub Repo",
          "left": 200,
          "top": 200,
          "width": 700,
          "height": 500,
          "minimized": true,  // Minimized
          "pinnedToUrl": null,
          "slotNumber": 2,
          "activeTabId": 123
        }
      ],
      "timestamp": 1699123456789
    },
    "firefox-container-2": {  // Work Container
      "tabs": [...],
      "timestamp": 1699123456790
    },
    "firefox-default": {  // Default Container
      "tabs": [...],
      "timestamp": 1699123456791
    }
  }
}
```

---

## 3. Implementation Steps

### Phase 1: Sidebar Panel Setup

#### Step 1.1: Update `manifest.json`

**Current:**
```json
"sidebar_action": {
  "default_panel": "sidebar/panel.html",
  "default_title": "Quick Tabs Manager",
  "default_icon": "icons/icon.png"
}
```

**Change to:**
```json
"sidebar_action": {
  "default_panel": "sidebar/quick-tabs-manager.html",  // Rename for clarity
  "default_title": "Quick Tabs Manager",
  "default_icon": "icons/sidebar-icon.png",  // Optional: dedicated sidebar icon
  "open_at_install": false  // Don't auto-open on install
}
```

#### Step 1.2: Create New Sidebar HTML

**File:** `sidebar/quick-tabs-manager.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Quick Tabs Manager</title>
  <link rel="stylesheet" href="quick-tabs-manager.css">
</head>
<body>
  <div class="sidebar-header">
    <h1>Quick Tabs Manager</h1>
    <div class="header-actions">
      <button id="closeMinimized" class="btn-secondary" title="Close all minimized Quick Tabs">
        Close Minimized
      </button>
      <button id="closeAll" class="btn-danger" title="Close all Quick Tabs (active + minimized)">
        Close All
      </button>
    </div>
  </div>

  <div class="sidebar-stats">
    <span id="totalTabs">0 Quick Tabs</span>
    <span id="lastSync">Last sync: Never</span>
  </div>

  <div id="containersList" class="containers-list">
    <!-- Dynamically populated by quick-tabs-manager.js -->
    <!-- Example structure:
    <div class="container-section" data-container-id="firefox-container-1">
      <h2 class="container-header">
        <span class="container-icon">📁</span>
        <span class="container-name">Personal</span>
        <span class="container-count">(3 tabs)</span>
      </h2>
      
      <div class="quick-tabs-list">
        <div class="quick-tab-item active" data-tab-id="qt_123">
          <span class="status-indicator green"></span>
          <img src="..." class="favicon">
          <div class="tab-info">
            <div class="tab-title">YouTube Video</div>
            <div class="tab-meta">Tab 2 • 800×600</div>
          </div>
          <div class="tab-actions">
            <button class="btn-icon" data-action="goToTab" title="Go to Tab 2">
              🔗
            </button>
            <button class="btn-icon" data-action="minimize" title="Minimize">
              ➖
            </button>
            <button class="btn-icon" data-action="close" title="Close">
              ✕
            </button>
          </div>
        </div>
        
        <div class="quick-tab-item minimized" data-tab-id="qt_456">
          <span class="status-indicator yellow"></span>
          <img src="..." class="favicon">
          <div class="tab-info">
            <div class="tab-title">GitHub Repository</div>
            <div class="tab-meta">Minimized • Tab 2</div>
          </div>
          <div class="tab-actions">
            <button class="btn-icon" data-action="restore" title="Restore">
              ↑
            </button>
            <button class="btn-icon" data-action="close" title="Close">
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
    -->
  </div>

  <div id="emptyState" class="empty-state" style="display: none;">
    <div class="empty-icon">📭</div>
    <div class="empty-text">No Quick Tabs</div>
    <div class="empty-hint">Press Q while hovering over a link to create one</div>
  </div>

  <script src="quick-tabs-manager.js"></script>
</body>
</html>
```

#### Step 1.3: Create Sidebar CSS

**File:** `sidebar/quick-tabs-manager.css`

```css
/* Quick Tabs Manager Sidebar Styles */

:root {
  --primary-bg: #ffffff;
  --secondary-bg: #f5f5f5;
  --border-color: #ddd;
  --text-primary: #333;
  --text-secondary: #666;
  --green-indicator: #4CAF50;
  --yellow-indicator: #FFC107;
  --red-danger: #f44336;
  --blue-primary: #4a90e2;
}

@media (prefers-color-scheme: dark) {
  :root {
    --primary-bg: #2d2d2d;
    --secondary-bg: #1e1e1e;
    --border-color: #555;
    --text-primary: #e0e0e0;
    --text-secondary: #999;
  }
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  background: var(--primary-bg);
  color: var(--text-primary);
  overflow-y: auto;
}

.sidebar-header {
  padding: 12px 16px;
  background: var(--secondary-bg);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 10;
}

.sidebar-header h1 {
  margin: 0 0 10px 0;
  font-size: 16px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-secondary,
.btn-danger {
  flex: 1;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: opacity 0.2s;
}

.btn-secondary {
  background: var(--blue-primary);
  color: white;
}

.btn-secondary:hover {
  opacity: 0.8;
}

.btn-danger {
  background: var(--red-danger);
  color: white;
}

.btn-danger:hover {
  opacity: 0.8;
}

.sidebar-stats {
  padding: 8px 16px;
  background: var(--secondary-bg);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
}

.containers-list {
  padding: 10px 0;
}

.container-section {
  margin-bottom: 16px;
}

.container-header {
  padding: 8px 16px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  background: var(--secondary-bg);
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 6px;
}

.container-icon {
  font-size: 14px;
}

.container-count {
  margin-left: auto;
  font-weight: normal;
  color: var(--text-secondary);
  font-size: 11px;
}

.quick-tabs-list {
  /* No padding - items have their own spacing */
}

.quick-tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
  transition: background 0.2s;
  cursor: pointer;
}

.quick-tab-item:hover {
  background: var(--secondary-bg);
}

.quick-tab-item.active {
  border-left: 3px solid var(--green-indicator);
  padding-left: 13px; /* Adjust for border */
}

.quick-tab-item.minimized {
  border-left: 3px solid var(--yellow-indicator);
  padding-left: 13px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-indicator.green {
  background: var(--green-indicator);
}

.status-indicator.yellow {
  background: var(--yellow-indicator);
}

.favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.tab-info {
  flex: 1;
  min-width: 0; /* Allow text truncation */
}

.tab-title {
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-meta {
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.tab-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon:hover {
  background: var(--border-color);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 12px;
}
```

---

### Phase 2: Sidebar JavaScript Logic

#### Step 2.1: Create Sidebar Script

**File:** `sidebar/quick-tabs-manager.js`

```javascript
// Quick Tabs Manager Sidebar Script
// Manages display and interaction with Quick Tabs across all containers

// Storage keys
const STATE_KEY = 'quick_tabs_state_v2';

// UI Elements (cached for performance)
let containersList;
let emptyState;
let totalTabsEl;
let lastSyncEl;

// State
let containersData = {}; // Maps cookieStoreId -> container info
let quickTabsState = {}; // Maps cookieStoreId -> { tabs: [], timestamp }

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Cache DOM elements
  containersList = document.getElementById('containersList');
  emptyState = document.getElementById('emptyState');
  totalTabsEl = document.getElementById('totalTabs');
  lastSyncEl = document.getElementById('lastSync');
  
  // Load container information from Firefox API
  await loadContainerInfo();
  
  // Load Quick Tabs state from storage
  await loadQuickTabsState();
  
  // Render initial UI
  renderUI();
  
  // Setup event listeners
  setupEventListeners();
  
  // Auto-refresh every 2 seconds
  setInterval(async () => {
    await loadQuickTabsState();
    renderUI();
  }, 2000);
});

/**
 * Load Firefox Container Tab information
 * Uses contextualIdentities API to get container names, icons, colors
 */
async function loadContainerInfo() {
  try {
    // Check if contextualIdentities API is available
    if (typeof browser.contextualIdentities === 'undefined') {
      console.warn('Contextual Identities API not available');
      // Fallback: Only show default container
      containersData['firefox-default'] = {
        name: 'Default',
        icon: '📁',
        color: 'grey',
        cookieStoreId: 'firefox-default'
      };
      return;
    }
    
    // Get all Firefox containers
    const containers = await browser.contextualIdentities.query({});
    
    // Map containers
    containersData = {};
    containers.forEach(container => {
      containersData[container.cookieStoreId] = {
        name: container.name,
        icon: getContainerIcon(container.icon),
        color: container.color,
        colorCode: container.colorCode,
        cookieStoreId: container.cookieStoreId
      };
    });
    
    // Always add default container
    containersData['firefox-default'] = {
      name: 'Default',
      icon: '📁',
      color: 'grey',
      colorCode: '#808080',
      cookieStoreId: 'firefox-default'
    };
    
    console.log('Loaded container info:', containersData);
  } catch (err) {
    console.error('Error loading container info:', err);
  }
}

/**
 * Convert Firefox container icon identifier to emoji
 */
function getContainerIcon(icon) {
  const iconMap = {
    'fingerprint': '🔒',
    'briefcase': '💼',
    'dollar': '💰',
    'cart': '🛒',
    'circle': '⭕',
    'gift': '🎁',
    'vacation': '🏖️',
    'food': '🍴',
    'fruit': '🍎',
    'pet': '🐾',
    'tree': '🌳',
    'chill': '❄️',
    'fence': '🚧'
  };
  
  return iconMap[icon] || '📁';
}

/**
 * Load Quick Tabs state from browser.storage.sync
 */
async function loadQuickTabsState() {
  try {
    const result = await browser.storage.sync.get(STATE_KEY);
    
    if (result && result[STATE_KEY]) {
      quickTabsState = result[STATE_KEY];
    } else {
      quickTabsState = {};
    }
    
    console.log('Loaded Quick Tabs state:', quickTabsState);
  } catch (err) {
    console.error('Error loading Quick Tabs state:', err);
  }
}

/**
 * Render the entire UI based on current state
 */
function renderUI() {
  // Calculate total tabs
  let totalTabs = 0;
  let latestTimestamp = 0;
  
  Object.keys(quickTabsState).forEach(cookieStoreId => {
    const containerState = quickTabsState[cookieStoreId];
    if (containerState && containerState.tabs) {
      totalTabs += containerState.tabs.length;
      if (containerState.timestamp > latestTimestamp) {
        latestTimestamp = containerState.timestamp;
      }
    }
  });
  
  // Update stats
  totalTabsEl.textContent = `${totalTabs} Quick Tab${totalTabs !== 1 ? 's' : ''}`;
  
  if (latestTimestamp > 0) {
    const date = new Date(latestTimestamp);
    lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
  } else {
    lastSyncEl.textContent = 'Last sync: Never';
  }
  
  // Show/hide empty state
  if (totalTabs === 0) {
    containersList.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  } else {
    containersList.style.display = 'block';
    emptyState.style.display = 'none';
  }
  
  // Clear containers list
  containersList.innerHTML = '';
  
  // Render each container section
  // Sort containers: Default first, then alphabetically
  const sortedContainers = Object.keys(containersData).sort((a, b) => {
    if (a === 'firefox-default') return -1;
    if (b === 'firefox-default') return 1;
    return containersData[a].name.localeCompare(containersData[b].name);
  });
  
  sortedContainers.forEach(cookieStoreId => {
    const containerInfo = containersData[cookieStoreId];
    const containerState = quickTabsState[cookieStoreId];
    
    if (!containerState || !containerState.tabs || containerState.tabs.length === 0) {
      // Skip containers with no Quick Tabs
      return;
    }
    
    renderContainerSection(cookieStoreId, containerInfo, containerState);
  });
}

/**
 * Render a single container section with its Quick Tabs
 */
function renderContainerSection(cookieStoreId, containerInfo, containerState) {
  const section = document.createElement('div');
  section.className = 'container-section';
  section.dataset.containerId = cookieStoreId;
  
  // Container header
  const header = document.createElement('h2');
  header.className = 'container-header';
  
  const icon = document.createElement('span');
  icon.className = 'container-icon';
  icon.textContent = containerInfo.icon;
  
  const name = document.createElement('span');
  name.className = 'container-name';
  name.textContent = containerInfo.name;
  
  const count = document.createElement('span');
  count.className = 'container-count';
  const tabCount = containerState.tabs.length;
  count.textContent = `(${tabCount} tab${tabCount !== 1 ? 's' : ''})`;
  
  header.appendChild(icon);
  header.appendChild(name);
  header.appendChild(count);
  
  section.appendChild(header);
  
  // Quick Tabs list
  const tabsList = document.createElement('div');
  tabsList.className = 'quick-tabs-list';
  
  // Separate active and minimized tabs
  const activeTabs = containerState.tabs.filter(t => !t.minimized);
  const minimizedTabs = containerState.tabs.filter(t => t.minimized);
  
  // Render active tabs first
  activeTabs.forEach(tab => {
    tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, false));
  });
  
  // Then minimized tabs
  minimizedTabs.forEach(tab => {
    tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, true));
  });
  
  section.appendChild(tabsList);
  containersList.appendChild(section);
}

/**
 * Render a single Quick Tab item
 */
function renderQuickTabItem(tab, cookieStoreId, isMinimized) {
  const item = document.createElement('div');
  item.className = `quick-tab-item ${isMinimized ? 'minimized' : 'active'}`;
  item.dataset.tabId = tab.id;
  item.dataset.containerId = cookieStoreId;
  
  // Status indicator
  const indicator = document.createElement('span');
  indicator.className = `status-indicator ${isMinimized ? 'yellow' : 'green'}`;
  
  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  try {
    const urlObj = new URL(tab.url);
    favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    favicon.onerror = () => {
      favicon.style.display = 'none';
    };
  } catch (e) {
    favicon.style.display = 'none';
  }
  
  // Tab info
  const tabInfo = document.createElement('div');
  tabInfo.className = 'tab-info';
  
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Quick Tab';
  title.title = tab.title || tab.url;
  
  const meta = document.createElement('div');
  meta.className = 'tab-meta';
  
  // Build metadata string
  let metaParts = [];
  
  if (isMinimized) {
    metaParts.push('Minimized');
  }
  
  if (tab.activeTabId) {
    metaParts.push(`Tab ${tab.activeTabId}`);
  }
  
  if (tab.width && tab.height) {
    metaParts.push(`${Math.round(tab.width)}×${Math.round(tab.height)}`);
  }
  
  if (tab.slotNumber) {
    metaParts.push(`Slot ${tab.slotNumber}`);
  }
  
  meta.textContent = metaParts.join(' • ');
  
  tabInfo.appendChild(title);
  tabInfo.appendChild(meta);
  
  // Tab actions
  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  
  if (!isMinimized) {
    // Active Quick Tab actions
    
    // Go to Tab button (NEW FEATURE)
    if (tab.activeTabId) {
      const goToTabBtn = document.createElement('button');
      goToTabBtn.className = 'btn-icon';
      goToTabBtn.textContent = '🔗';
      goToTabBtn.title = `Go to Tab ${tab.activeTabId}`;
      goToTabBtn.dataset.action = 'goToTab';
      goToTabBtn.dataset.tabId = tab.activeTabId;
      actions.appendChild(goToTabBtn);
    }
    
    // Minimize button
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'btn-icon';
    minimizeBtn.textContent = '➖';
    minimizeBtn.title = 'Minimize';
    minimizeBtn.dataset.action = 'minimize';
    minimizeBtn.dataset.quickTabId = tab.id;
    actions.appendChild(minimizeBtn);
    
  } else {
    // Minimized Quick Tab actions
    
    // Restore button
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn-icon';
    restoreBtn.textContent = '↑';
    restoreBtn.title = 'Restore';
    restoreBtn.dataset.action = 'restore';
    restoreBtn.dataset.quickTabId = tab.id;
    actions.appendChild(restoreBtn);
  }
  
  // Close button (always available)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.dataset.action = 'close';
  closeBtn.dataset.quickTabId = tab.id;
  actions.appendChild(closeBtn);
  
  // Assemble item
  item.appendChild(indicator);
  item.appendChild(favicon);
  item.appendChild(tabInfo);
  item.appendChild(actions);
  
  return item;
}

/**
 * Setup event listeners for user interactions
 */
function setupEventListeners() {
  // Close Minimized button
  document.getElementById('closeMinimized').addEventListener('click', async () => {
    await closeMinimizedTabs();
  });
  
  // Close All button
  document.getElementById('closeAll').addEventListener('click', async () => {
    await closeAllTabs();
  });
  
  // Delegated event listener for Quick Tab actions
  containersList.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    
    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;
    
    switch (action) {
      case 'goToTab':
        await goToTab(parseInt(tabId));
        break;
      case 'minimize':
        await minimizeQuickTab(quickTabId);
        break;
      case 'restore':
        await restoreQuickTab(quickTabId);
        break;
      case 'close':
        await closeQuickTab(quickTabId);
        break;
    }
  });
  
  // Listen for storage changes to auto-update
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[STATE_KEY]) {
      loadQuickTabsState().then(() => {
        renderUI();
      });
    }
  });
}

/**
 * Close all minimized Quick Tabs (NEW FEATURE #1)
 */
async function closeMinimizedTabs() {
  try {
    // Get current state
    const result = await browser.storage.sync.get(STATE_KEY);
    if (!result || !result[STATE_KEY]) return;
    
    const state = result[STATE_KEY];
    let hasChanges = false;
    
    // Filter out minimized tabs from each container
    Object.keys(state).forEach(cookieStoreId => {
      if (state[cookieStoreId] && state[cookieStoreId].tabs) {
        const originalLength = state[cookieStoreId].tabs.length;
        state[cookieStoreId].tabs = state[cookieStoreId].tabs.filter(t => !t.minimized);
        
        if (state[cookieStoreId].tabs.length !== originalLength) {
          hasChanges = true;
          state[cookieStoreId].timestamp = Date.now();
        }
      }
    });
    
    if (hasChanges) {
      // Save updated state
      await browser.storage.sync.set({ [STATE_KEY]: state });
      
      // Notify all content scripts to update their local state
      const tabs = await browser.tabs.query({});
      tabs.forEach(tab => {
        browser.tabs.sendMessage(tab.id, {
          action: 'CLOSE_MINIMIZED_QUICK_TABS'
        }).catch(() => {
          // Ignore errors for tabs where content script isn't loaded
        });
      });
      
      console.log('Closed all minimized Quick Tabs');
    }
  } catch (err) {
    console.error('Error closing minimized tabs:', err);
  }
}

/**
 * Close all Quick Tabs - both active and minimized (NEW FEATURE #2)
 */
async function closeAllTabs() {
  try {
    // Clear all Quick Tabs from storage
    await browser.storage.sync.remove(STATE_KEY);
    
    // Notify all content scripts to close Quick Tabs
    const tabs = await browser.tabs.query({});
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, {
        action: 'CLEAR_ALL_QUICK_TABS'
      }).catch(() => {
        // Ignore errors
      });
    });
    
    console.log('Closed all Quick Tabs');
    
    // Update UI immediately
    quickTabsState = {};
    renderUI();
  } catch (err) {
    console.error('Error closing all tabs:', err);
  }
}

/**
 * Go to the browser tab containing this Quick Tab (NEW FEATURE #3)
 */
async function goToTab(tabId) {
  try {
    await browser.tabs.update(tabId, { active: true });
    console.log(`Switched to tab ${tabId}`);
  } catch (err) {
    console.error(`Error switching to tab ${tabId}:`, err);
    alert('Could not switch to tab - it may have been closed.');
  }
}

/**
 * Minimize an active Quick Tab
 */
async function minimizeQuickTab(quickTabId) {
  try {
    // Send message to content script in active tab
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length === 0) return;
    
    await browser.tabs.sendMessage(activeTabs[0].id, {
      action: 'MINIMIZE_QUICK_TAB',
      quickTabId: quickTabId
    });
    
    console.log(`Minimized Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error minimizing Quick Tab ${quickTabId}:`, err);
  }
}

/**
 * Restore a minimized Quick Tab
 */
async function restoreQuickTab(quickTabId) {
  try {
    // Send message to content script in active tab
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length === 0) return;
    
    await browser.tabs.sendMessage(activeTabs[0].id, {
      action: 'RESTORE_QUICK_TAB',
      quickTabId: quickTabId
    });
    
    console.log(`Restored Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error restoring Quick Tab ${quickTabId}:`, err);
  }
}

/**
 * Close a Quick Tab
 */
async function closeQuickTab(quickTabId) {
  try {
    // Send message to all tabs to close this Quick Tab
    const tabs = await browser.tabs.query({});
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, {
        action: 'CLOSE_QUICK_TAB',
        quickTabId: quickTabId
      }).catch(() => {
        // Ignore errors
      });
    });
    
    console.log(`Closed Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error closing Quick Tab ${quickTabId}:`, err);
  }
}
```

---

### Phase 3: Content Script Integration

#### Step 3.1: Remove Floating Manager Code

**File:** `content.js`

**REMOVE these functions:**
- `updateMinimizedTabsManager()`
- `makeDraggable()` calls for minimized manager
- All DOM creation for `.copy-url-minimized-manager`

**Find and DELETE:**
```javascript
// DELETE THIS ENTIRE FUNCTION
function updateMinimizedTabsManager() {
  let manager = document.querySelector('.copy-url-minimized-manager');
  
  if (minimizedQuickTabs.length === 0) {
    if (manager) {
      manager.remove();
    }
    return;
  }
  
  if (!manager) {
    // ... 50+ lines of DOM creation ...
  }
  
  // ... rest of function ...
}
```

#### Step 3.2: Update Minimize/Restore Functions

**File:** `content.js`

**REPLACE `minimizeQuickTab` function:**

```javascript
// Minimize Quick Tab - Updated for Sidebar API (v1.5.8)
async function minimizeQuickTab(container, url, title) {
  const index = quickTabWindows.indexOf(container);
  if (index > -1) {
    quickTabWindows.splice(index, 1);
  }
  
  const quickTabId = container.dataset.quickTabId;
  const rect = container.getBoundingClientRect();
  
  // Get active browser tab ID
  let activeTabId = null;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;
    }
  } catch (err) {
    debug('Error getting active tab ID:', err);
  }
  
  // Update Quick Tab state to minimized = true
  const quickTabData = {
    id: quickTabId,
    url: url,
    title: title || 'Quick Tab',
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    minimized: true,  // Mark as minimized
    pinnedToUrl: container._pinnedToUrl || null,
    slotNumber: CONFIG.debugMode ? (quickTabSlots.get(quickTabId) || null) : null,
    activeTabId: activeTabId,  // NEW: Track which tab contains this Quick Tab
    timestamp: Date.now()
  };
  
  // Remove from DOM
  container.remove();
  
  // Save to storage via queue
  if (CONFIG.quickTabPersistAcrossTabs && quickTabId) {
    saveQuickTabState('minimize', quickTabId, quickTabData).catch(err => {
      debug('Error saving minimized Quick Tab:', err);
    });
  }
  
  showNotification('✓ Quick Tab minimized');
  debug(`Quick Tab minimized: ${url} (ID: ${quickTabId})`);
}
```

**REPLACE `restoreQuickTab` function:**

```javascript
// Restore minimized Quick Tab - Updated for Sidebar API (v1.5.8)
async function restoreQuickTab(quickTabId) {
  if (!quickTabId) return;
  
  // Load state from storage to get Quick Tab details
  try {
    const cookieStoreId = await getCurrentCookieStoreId();
    const result = await browser.storage.sync.get('quick_tabs_state_v2');
    
    if (!result || !result.quick_tabs_state_v2) {
      debug('No Quick Tabs state found');
      return;
    }
    
    const state = result.quick_tabs_state_v2;
    const containerState = state[cookieStoreId];
    
    if (!containerState || !containerState.tabs) {
      debug(`No Quick Tabs for container ${cookieStoreId}`);
      return;
    }
    
    // Find the Quick Tab to restore
    const tab = containerState.tabs.find(t => t.id === quickTabId);
    
    if (!tab) {
      debug(`Quick Tab ${quickTabId} not found in storage`);
      return;
    }
    
    // Create Quick Tab window with stored properties
    createQuickTabWindow(
      tab.url,
      tab.width,
      tab.height,
      tab.left,
      tab.top,
      true, // fromBroadcast = true (don't re-save)
      tab.pinnedToUrl,
      tab.id
    );
    
    // Update storage to mark as not minimized
    const updatedTabs = containerState.tabs.map(t => {
      if (t.id === quickTabId) {
        return { ...t, minimized: false };
      }
      return t;
    });
    
    state[cookieStoreId].tabs = updatedTabs;
    state[cookieStoreId].timestamp = Date.now();
    
    await browser.storage.sync.set({ quick_tabs_state_v2: state });
    
    debug(`Quick Tab restored: ${tab.url} (ID: ${quickTabId})`);
  } catch (err) {
    console.error('Error restoring Quick Tab:', err);
  }
}
```

#### Step 3.3: Add Message Handlers for Sidebar

**File:** `content.js`

**ADD to existing `browser.runtime.onMessage.addListener`:**

```javascript
// Runtime message listener - ADD these new cases
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ... existing cases ...
  
  // NEW: Handle minimize command from sidebar
  if (message.action === 'MINIMIZE_QUICK_TAB') {
    const quickTabId = message.quickTabId;
    const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);
    
    if (container) {
      const iframe = container.querySelector('iframe');
      const url = iframe?.src || iframe?.getAttribute('data-deferred-src');
      const titleEl = container.querySelector('.copy-url-quicktab-titlebar span');
      const title = titleEl?.textContent || 'Quick Tab';
      
      minimizeQuickTab(container, url, title);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Quick Tab not found' });
    }
    return true;
  }
  
  // NEW: Handle restore command from sidebar
  if (message.action === 'RESTORE_QUICK_TAB') {
    restoreQuickTab(message.quickTabId);
    sendResponse({ success: true });
    return true;
  }
  
  // NEW: Handle close minimized command from sidebar
  if (message.action === 'CLOSE_MINIMIZED_QUICK_TABS') {
    // Remove minimized tabs from local array (if still using it)
    // Note: With sidebar API, this is mainly for cleanup
    minimizedQuickTabs = [];
    sendResponse({ success: true });
    return true;
  }
  
  // NEW: Handle close specific Quick Tab from sidebar
  if (message.action === 'CLOSE_QUICK_TAB') {
    const quickTabId = message.quickTabId;
    const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);
    
    if (container) {
      closeQuickTabWindow(container);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Quick Tab not found' });
    }
    return true;
  }
  
  return true;
});
```

---

### Phase 4: Storage Schema Updates

#### Step 4.1: Update Save Functions to Include activeTabId

**File:** `content.js`

**UPDATE `saveQuickTabState` function:**

```javascript
async function saveQuickTabState(operationType, quickTabId, additionalData = {}) {
  if (!CONFIG.quickTabPersistAcrossTabs) {
    return Promise.resolve();
  }
  
  // Build current state for this Quick Tab
  let quickTabData = null;
  
  if (operationType === 'delete') {
    quickTabData = { id: quickTabId };
  } else {
    const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);
    
    if (!container && operationType !== 'minimize') {
      debug(`[SAVE] Quick Tab ${quickTabId} not found, skipping save`);
      return Promise.resolve();
    }
    
    // Get active browser tab ID
    let activeTabId = null;
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        activeTabId = tabs[0].id;
      }
    } catch (err) {
      debug('Error getting active tab ID:', err);
    }
    
    if (operationType === 'minimize') {
      // For minimize, get data from minimizedQuickTabs array or additionalData
      quickTabData = { 
        ...additionalData,
        activeTabId: activeTabId  // NEW
      };
    } else {
      // Build state from container
      const iframe = container.querySelector('iframe');
      const titleText = container.querySelector('.copy-url-quicktab-titlebar span');
      const rect = container.getBoundingClientRect();
      const url = iframe?.src || iframe?.getAttribute('data-deferred-src') || '';
      
      quickTabData = {
        id: quickTabId,
        url: url,
        title: titleText?.textContent || 'Quick Tab',
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        pinnedToUrl: container._pinnedToUrl || null,
        slotNumber: CONFIG.debugMode ? (quickTabSlots.get(quickTabId) || null) : null,
        minimized: false,
        activeTabId: activeTabId,  // NEW
        ...additionalData
      };
    }
  }
  
  // Enqueue save operation
  return saveQueue.enqueue({
    type: operationType,
    quickTabId: quickTabId,
    data: quickTabData,
    priority: operationType === 'create' ? 2 : 1
  });
}
```

---

### Phase 5: Keyboard Shortcut for Sidebar Toggle

#### Step 5.1: Add Keyboard Command

**File:** `manifest.json`

**UPDATE `commands` section:**

```json
"commands": {
  "toggle-minimized-manager": {
    "suggested_key": {
      "default": "Ctrl+Shift+M",
      "mac": "Command+Shift+M"
    },
    "description": "Toggle Quick Tabs Manager sidebar"
  }
}
```

#### Step 5.2: Handle Command in Background Script

**File:** `background.js`

**ADD command listener:**

```javascript
// Listen for keyboard commands
browser.commands.onCommand.addListener((command) => {
  if (command === 'toggle-minimized-manager') {
    // Toggle sidebar visibility
    browser.sidebarAction.isOpen({}).then(isOpen => {
      if (isOpen) {
        browser.sidebarAction.close();
      } else {
        browser.sidebarAction.open();
      }
    }).catch(err => {
      // Fallback for older Firefox versions
      browser.sidebarAction.toggle();
    });
  }
});
```

---

## 4. File Changes Summary

### Files to MODIFY

1. **`manifest.json`**
   - Update `sidebar_action.default_panel` to `"sidebar/quick-tabs-manager.html"`
   - Update `commands` to include sidebar toggle

2. **`content.js`**
   - **REMOVE:** `updateMinimizedTabsManager()` function (entire function ~50-100 lines)
   - **UPDATE:** `minimizeQuickTab()` function to save `activeTabId`
   - **UPDATE:** `restoreQuickTab()` function to use storage-based restore
   - **UPDATE:** `saveQuickTabState()` to include `activeTabId`
   - **ADD:** Message handlers for sidebar commands (`MINIMIZE_QUICK_TAB`, `RESTORE_QUICK_TAB`, etc.)

3. **`background.js`**
   - **ADD:** Command listener for `toggle-minimized-manager` keyboard shortcut

### Files to CREATE

1. **`sidebar/quick-tabs-manager.html`** (NEW)
   - Full HTML structure with container sections
   - Action buttons (Close Minimized, Close All)
   - Quick Tab items with status indicators

2. **`sidebar/quick-tabs-manager.css`** (NEW)
   - Complete styling for sidebar UI
   - Container section styles
   - Quick Tab item styles with green/yellow indicators

3. **`sidebar/quick-tabs-manager.js`** (NEW)
   - Load container info from `contextualIdentities` API
   - Load Quick Tabs state from `browser.storage.sync`
   - Render UI with container categorization
   - Handle user actions (restore, minimize, close, go to tab)

### Files to DELETE (Optional)

1. **`sidebar/panel.html`** (if not reused)
2. **`sidebar/panel.js`** (if not reused)

---

## 5. Container Tab Integration

### Firefox Container API Usage

```javascript
// Get all containers
const containers = await browser.contextualIdentities.query({});

// Example container object:
{
  "cookieStoreId": "firefox-container-1",
  "name": "Personal",
  "icon": "fingerprint",
  "color": "blue",
  "colorCode": "#37ADFF"
}
```

### Storage Structure with Containers

```javascript
// browser.storage.sync structure
{
  "quick_tabs_state_v2": {
    "firefox-container-1": {
      "tabs": [
        {
          "id": "qt_123",
          "url": "...",
          "minimized": false,
          "activeTabId": 5  // Browser tab ID
        }
      ],
      "timestamp": 1699123456789
    },
    "firefox-container-2": {
      "tabs": [...],
      "timestamp": 1699123456790
    }
  }
}
```

---

## 6. UI/UX Specifications

### Visual Indicators

- **🟢 Green Indicator:** Active Quick Tab
- **🟡 Yellow Indicator:** Minimized Quick Tab

### Container Icons

Map Firefox icon identifiers to emoji:

```javascript
const iconMap = {
  'fingerprint': '🔒',
  'briefcase': '💼',
  'dollar': '💰',
  'cart': '🛒',
  'circle': '⭕',
  'gift': '🎁',
  'vacation': '🏖️',
  'food': '🍴',
  'fruit': '🍎',
  'pet': '🐾',
  'tree': '🌳',
  'chill': '❄️',
  'fence': '🚧'
};
```

### Action Buttons

| Button | Icon | Action | Visibility |
|--------|------|--------|-----------|
| Go to Tab | 🔗 | Switch to browser tab containing Quick Tab | Active tabs only |
| Minimize | ➖ | Minimize Quick Tab | Active tabs only |
| Restore | ↑ | Restore minimized Quick Tab | Minimized tabs only |
| Close | ✕ | Close Quick Tab | All tabs |

### Layout Example

```
┌─────────────────────────────────────┐
│ Quick Tabs Manager                  │
│ [Close Minimized] [Close All]       │
├─────────────────────────────────────┤
│ 3 Quick Tabs │ Last sync: 10:22 PM  │
├─────────────────────────────────────┤
│ 📁 Personal (2 tabs)                │
│ ├─ 🟢 YouTube Video                 │
│ │   Tab 2 • 800×600 • Slot 1        │
│ │   [🔗] [➖] [✕]                    │
│ ├─ 🟡 GitHub Repo                   │
│ │   Minimized • Tab 2 • 700×500     │
│ │   [↑] [✕]                          │
├─────────────────────────────────────┤
│ 📁 Work (1 tab)                     │
│ ├─ 🟢 Slack Workspace               │
│ │   Tab 5 • 900×700 • Slot 2        │
│ │   [🔗] [➖] [✕]                    │
└─────────────────────────────────────┘
```

---

## 7. Testing & Validation

### Test Cases

#### Test 1: Basic Sidebar Functionality
1. Open extension
2. Create Quick Tab with `Q` key
3. Open sidebar with `Ctrl+Shift+M`
4. Verify Quick Tab appears in sidebar with green indicator
5. Minimize Quick Tab from sidebar
6. Verify indicator changes to yellow
7. Restore Quick Tab from sidebar
8. Verify Quick Tab reappears at original position

#### Test 2: Container Tab Separation
1. Open 3 Firefox Container Tabs: Personal, Work, Banking
2. Create Quick Tab in Personal container
3. Create Quick Tab in Work container
4. Open sidebar
5. Verify Quick Tabs are categorized under correct containers
6. Verify each container shows tab count

#### Test 3: Go to Tab Feature
1. Create Quick Tab in Tab 2
2. Switch to Tab 5
3. Open sidebar
4. Click "Go to Tab" button for Quick Tab
5. Verify browser switches to Tab 2
6. Verify Quick Tab is still active

#### Test 4: Close Minimized Button
1. Minimize 3 Quick Tabs
2. Create 2 active Quick Tabs
3. Open sidebar
4. Click "Close Minimized" button
5. Verify only minimized tabs are closed
6. Verify active tabs remain

#### Test 5: Close All Button
1. Create 5 Quick Tabs (3 active, 2 minimized)
2. Open sidebar
3. Click "Close All" button
4. Verify ALL Quick Tabs are closed
5. Verify empty state is displayed

#### Test 6: Cross-Tab Persistence
1. Create Quick Tab in Tab 1
2. Switch to Tab 2
3. Open sidebar
4. Verify Quick Tab is visible in sidebar
5. Minimize Quick Tab from sidebar
6. Switch back to Tab 1
7. Open sidebar
8. Verify Quick Tab shows as minimized

#### Test 7: Position Restoration
1. Create Quick Tab at position (500, 300)
2. Minimize Quick Tab
3. Restore Quick Tab
4. Verify Quick Tab reappears at (500, 300), NOT bottom-right

---

## 8. Migration Notes

### Backward Compatibility

The sidebar implementation is **fully backward compatible** with v1.5.7:

- Existing Quick Tabs in `quick_tabs_state_v2` storage will continue to work
- No data migration needed for basic functionality
- `activeTabId` field is optional (defaults to `null` if missing)

### Migration Steps for Users

1. **Automatic:** Upon updating to v1.5.8, sidebar is available but not auto-opened
2. Users can:
   - Press `Ctrl+Shift+M` to open sidebar
   - Click extension icon → "Open Quick Tabs Manager" (optional UI addition)
   - Right-click toolbar → View Sidebar → Quick Tabs Manager

### Developer Migration Checklist

- [ ] Remove all `updateMinimizedTabsManager()` references from `content.js`
- [ ] Update `minimizeQuickTab()` to save `activeTabId`
- [ ] Update `restoreQuickTab()` to use storage-based lookup
- [ ] Create `sidebar/quick-tabs-manager.html`
- [ ] Create `sidebar/quick-tabs-manager.css`
- [ ] Create `sidebar/quick-tabs-manager.js`
- [ ] Update `manifest.json` commands
- [ ] Add command listener to `background.js`
- [ ] Test all 7 test cases
- [ ] Update documentation (`README.md`, `CHANGELOG.md`)

---

## 9. Known Issues & Limitations (from "Minimized Quick Tab Manager Thread #1")

### Issue 1: Position Loss When Minimizing

**Problem:** When a Quick Tab is minimized, restoring it always opens at bottom-right corner instead of original position.

**Root Cause:** Minimized tabs array only stores `url`, `title`, `timestamp` - not position/size.

**Solution (Implemented in this document):**
```javascript
// OLD (v1.5.7)
minimizedQuickTabs.push({
  url: url,
  title: title,
  timestamp: Date.now()
});

// NEW (v1.5.8) - Store complete state
minimizedQuickTabs.push({
  id: quickTabId,
  url: url,
  title: title,
  left: rect.left,      // ADDED
  top: rect.top,        // ADDED
  width: rect.width,    // ADDED
  height: rect.height,  // ADDED
  pinnedToUrl: ...,     // ADDED
  slotNumber: ...,      // ADDED
  minimized: true,
  activeTabId: ...,     // ADDED
  timestamp: Date.now()
});
```

### Issue 2: Missing Modern API Integration

**Problem:** Minimized manager not integrated with BroadcastChannel, Pointer Events, or browser.storage.sync.

**Solution (Implemented):**
- Sidebar uses `browser.storage.sync` with `storage.onChanged` listener
- No BroadcastChannel needed (sidebar is ONE instance shared across tabs)
- Pointer Events not needed (sidebar is native Firefox UI, not draggable div)

### Issue 3: Cross-Tab Persistence Bugs

**Problem:** Minimized manager disappears when switching tabs, bugs out with multiple minimized tabs across webpages.

**Solution (Implemented):**
- Sidebar API provides **native cross-tab persistence**
- No recreation needed when switching tabs
- Storage-based state means all tabs see same minimized Quick Tabs

---

## 10. Future Enhancements (Optional)

### Enhancement 1: Drag-and-Drop Reordering

Allow users to reorder Quick Tabs within sidebar by dragging items:

```javascript
// Add to quick-tabs-manager.js
let draggedItem = null;

item.draggable = true;
item.addEventListener('dragstart', (e) => {
  draggedItem = item;
  e.dataTransfer.effectAllowed = 'move';
});

item.addEventListener('dragover', (e) => {
  e.preventDefault();
  // Visual feedback
});

item.addEventListener('drop', (e) => {
  e.preventDefault();
  // Reorder tabs array and update storage
});
```

### Enhancement 2: Search/Filter

Add search box to filter Quick Tabs by title or URL:

```html
<div class="sidebar-search">
  <input type="text" id="searchInput" placeholder="Search Quick Tabs...">
</div>
```

### Enhancement 3: Bulk Actions

Add checkboxes for selecting multiple Quick Tabs:

```html
<input type="checkbox" class="quick-tab-checkbox" data-tab-id="qt_123">
```

---

## 11. Troubleshooting

### Issue: Sidebar not appearing

**Solution:**
1. Check `manifest.json` has `sidebar_action` correctly defined
2. Verify `sidebar/quick-tabs-manager.html` exists
3. Check Firefox version supports `sidebarAction` API (Firefox 54+)
4. Try reloading extension

### Issue: Quick Tabs not showing in sidebar

**Solution:**
1. Open browser console for sidebar (`about:debugging` → Inspect sidebar)
2. Check for JavaScript errors in `quick-tabs-manager.js`
3. Verify `browser.storage.sync` permissions in `manifest.json`
4. Check `contextualIdentities` permission for container support

### Issue: "Go to Tab" button not working

**Solution:**
1. Verify `activeTabId` is being saved in `saveQuickTabState()`
2. Check browser tab still exists (not closed)
3. Verify `browser.tabs.update()` has correct permissions

---

## 12. Document Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-11 | Initial document creation |

---

## 13. References

- [Firefox Sidebar API Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction)
- [Firefox Contextual Identities API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities)
- [browser.storage.sync Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)
- [Extension Repository](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition)

---

**END OF DOCUMENT**

This implementation guide provides complete, production-ready code that a GitHub Copilot Agent can use to implement the Firefox Sidebar API for Quick Tabs management while maintaining full compatibility with existing extension functionality.