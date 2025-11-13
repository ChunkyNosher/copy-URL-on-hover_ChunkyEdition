# Persistent Floating Quick Tabs Manager Panel Implementation

**Document Version:** 1.0.0  
**Target Extension Version:** 1.5.9+  
**Last Updated:** 2025-11-11  
**Optimized for:** GitHub Copilot Agent & Human Developers  
**Compatibility:** Zen Browser & Firefox

---

## Executive Summary

This document provides a complete implementation guide for **replacing the Firefox Sidebar API** with a **persistent, draggable, resizable floating panel** that works in Zen Browser (where `sidebar.verticalTabs` is disabled). The panel will:

1. ✅ **Persist across page navigations** (doesn't close like normal popups)
2. ✅ **Be draggable** like Quick Tabs (using Pointer Events API)
3. ✅ **Be resizable** from all edges/corners
4. ✅ **Remember position and size** across sessions
5. ✅ **Work with keyboard shortcuts** (`Ctrl+Alt+Z` to toggle)
6. ✅ **Maintain all sidebar features** (Container Tab categorization, action buttons, etc.)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Implementation Approach](#2-implementation-approach)
3. [File Structure](#3-file-structure)
4. [Implementation Steps](#4-implementation-steps)
5. [Persistent Panel Injection](#5-persistent-panel-injection)
6. [Drag & Resize Implementation](#6-drag--resize-implementation)
7. [Keyboard Shortcut Integration](#7-keyboard-shortcut-integration)
8. [Storage & State Management](#8-storage--state-management)
9. [Testing & Validation](#9-testing--validation)

---

## 1. Architecture Overview

### Current Problem (Sidebar in Zen Browser)

```
❌ Firefox Sidebar API → Disabled in Zen Browser
   sidebar_action in manifest.json → Does NOT work
   Keyboard shortcuts → Not functional
```

### New Solution (Floating Panel)

```
✅ Content Script Injection → Injects panel into page DOM
   Floating Panel → Positioned fixed, outside page content
   Pointer Events → Drag/resize with setPointerCapture
   Keyboard Command → background.js → sendMessage → content.js → toggle panel
   browser.storage.local → Saves panel position/size
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    BACKGROUND SCRIPT                        │
│  (background.js)                                            │
│                                                             │
│  ┌───────────────────────────────────────────────────┐     │
│  │ Listen: browser.commands.onCommand                │     │
│  │ Command: "toggle-quick-tabs-manager"              │     │
│  │ Action: Send message to active tab                │     │
│  └───────────────────────┬───────────────────────────┘     │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │ Message: TOGGLE_QUICK_TABS_PANEL
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    CONTENT SCRIPT                           │
│  (content.js)                                               │
│                                                             │
│  ┌───────────────────────────────────────────────────┐     │
│  │ Create/Toggle Floating Panel in DOM                │     │
│  │ Position: Fixed (z-index: 999999999)              │     │
│  │ Features: Drag, Resize, Minimize, Close           │     │
│  └───────────────────────┬───────────────────────────┘     │
│                          │                                  │
│                          │ Load Quick Tabs State            │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────┐      │
│  │   browser.storage.sync                           │      │
│  │   Key: quick_tabs_state_v2                       │      │
│  │   Container-keyed Quick Tabs data                │      │
│  └──────────────────────────────────────────────────┘      │
│                                                             │
│  ┌──────────────────────────────────────────────────┐      │
│  │   browser.storage.local                          │      │
│  │   Key: quick_tabs_panel_state                    │      │
│  │   { left, top, width, height, isOpen }           │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Implementation Approach

### Strategy: Content Script Injection (Persistent Panel)

Instead of using:

- ❌ `sidebar_action` (doesn't work in Zen Browser)
- ❌ `browser_action` popup (closes when clicked outside)

We use:

- ✅ **Content script** that injects a **floating div** into the page
- ✅ Panel is **persistent** (doesn't auto-close)
- ✅ Panel **survives page navigation** (re-injected on each page load)
- ✅ Uses **Pointer Events API** for drag/resize (same as Quick Tabs)

### Key Differences from Quick Tabs

| Feature     | Quick Tabs           | Manager Panel                             |
| ----------- | -------------------- | ----------------------------------------- |
| Z-Index     | 1000000+             | 999999999 (always on top)                 |
| Drag Handle | Title bar            | Entire header bar                         |
| Resize      | All edges/corners    | All edges/corners                         |
| Persistence | browser.storage.sync | browser.storage.local (panel state)       |
| Toggle      | N/A                  | Keyboard shortcut + click outside to hide |

---

## 3. File Structure

### Files to MODIFY

1. **`manifest.json`**
   - **REMOVE:** `sidebar_action` (doesn't work in Zen)
   - **UPDATE:** `commands` to add toggle keyboard shortcut

2. **`background.js`**
   - **ADD:** Command listener for `toggle-quick-tabs-manager`
   - **ADD:** Message handler to toggle panel in active tab

3. **`content.js`**
   - **ADD:** Floating panel creation function
   - **ADD:** Drag/resize implementation for panel
   - **ADD:** Message listener for toggle command
   - **ADD:** Panel state management (open/closed)

### Files to CREATE

1. **`manager-panel.html`** (NEW - embedded as string in content.js)
   - HTML structure for floating panel
   - Embedded inline, NOT a separate file

2. **`manager-panel.css`** (NEW - embedded as string in content.js)
   - CSS for floating panel
   - Embedded inline, NOT a separate file

### Files to REFERENCE (No Changes)

- `sidebar/quick-tabs-manager.js` → Logic reused for panel
- `sidebar/quick-tabs-manager.css` → Styles adapted for panel

---

## 4. Implementation Steps

### Phase 1: Manifest & Background Script Changes

#### Step 1.1: Update `manifest.json`

**Current:**

```json
{
  "sidebar_action": {
    "default_panel": "sidebar/quick-tabs-manager.html",
    "default_title": "Quick Tabs Manager",
    "default_icon": "icons/icon.png",
    "open_at_install": false
  },

  "commands": {
    "toggle-minimized-manager": {
      "suggested_key": {
        "default": "Ctrl+Shift+M",
        "mac": "Command+Shift+M"
      },
      "description": "Toggle minimized Quick Tabs manager visibility"
    }
  }
}
```

**NEW (v1.5.9):**

```json
{
  "commands": {
    "toggle-quick-tabs-manager": {
      "suggested_key": {
        "default": "Ctrl+Alt+Z",
        "mac": "Command+Option+Z"
      },
      "description": "Toggle Quick Tabs Manager panel"
    }
  }
}
```

**REMOVE:** Entire `sidebar_action` block

#### Step 1.2: Update `background.js`

**ADD this code:**

```javascript
// ==================== QUICK TABS MANAGER PANEL TOGGLE ====================
// Listen for keyboard command to toggle floating panel
browser.commands.onCommand.addListener(async command => {
  if (command === 'toggle-quick-tabs-manager') {
    // Get active tab in current window
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });

      if (tabs.length === 0) {
        console.error('[QuickTabsManager] No active tab found');
        return;
      }

      const activeTab = tabs[0];

      // Send message to content script to toggle panel
      browser.tabs
        .sendMessage(activeTab.id, {
          action: 'TOGGLE_QUICK_TABS_PANEL'
        })
        .catch(err => {
          console.error('[QuickTabsManager] Error sending toggle message:', err);
          // Content script may not be loaded yet - inject it
          browser.tabs
            .executeScript(activeTab.id, {
              file: 'content.js'
            })
            .then(() => {
              // Try again after injection
              browser.tabs.sendMessage(activeTab.id, {
                action: 'TOGGLE_QUICK_TABS_PANEL'
              });
            });
        });

      console.log('[QuickTabsManager] Toggle command sent to tab', activeTab.id);
    } catch (err) {
      console.error('[QuickTabsManager] Error handling toggle command:', err);
    }
  }
});
// ==================== END QUICK TABS MANAGER PANEL TOGGLE ====================
```

---

### Phase 2: Content Script - Floating Panel Injection

#### Step 2.1: Add Panel HTML & CSS Templates

**ADD to `content.js` (at the top, after other constants):**

```javascript
// ==================== QUICK TABS MANAGER PANEL HTML/CSS ====================
// HTML template for floating panel (embedded inline for easy injection)
const PANEL_HTML = `
<div id="quick-tabs-manager-panel" class="quick-tabs-manager-panel" style="display: none;">
  <div class="panel-header">
    <span class="panel-drag-handle">≡</span>
    <h2 class="panel-title">Quick Tabs Manager</h2>
    <div class="panel-controls">
      <button class="panel-btn panel-minimize" title="Minimize Panel">−</button>
      <button class="panel-btn panel-close" title="Close Panel">✕</button>
    </div>
  </div>
  
  <div class="panel-actions">
    <button id="panel-closeMinimized" class="panel-btn-secondary" title="Close all minimized Quick Tabs">
      Close Minimized
    </button>
    <button id="panel-closeAll" class="panel-btn-danger" title="Close all Quick Tabs">
      Close All
    </button>
  </div>
  
  <div class="panel-stats">
    <span id="panel-totalTabs">0 Quick Tabs</span>
    <span id="panel-lastSync">Last sync: Never</span>
  </div>
  
  <div id="panel-containersList" class="panel-containers-list">
    <!-- Dynamically populated -->
  </div>
  
  <div id="panel-emptyState" class="panel-empty-state" style="display: none;">
    <div class="empty-icon">📭</div>
    <div class="empty-text">No Quick Tabs</div>
    <div class="empty-hint">Press Q while hovering over a link</div>
  </div>
</div>
`;

// CSS template for floating panel
const PANEL_CSS = `
/* Quick Tabs Manager Floating Panel Styles */

.quick-tabs-manager-panel {
  position: fixed;
  top: 100px;
  right: 20px;
  width: 350px;
  height: 500px;
  background: #2d2d2d;
  border: 2px solid #555;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 999999999; /* Above all Quick Tabs */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 250px;
  min-height: 300px;
}

/* Panel Header (draggable) */
.panel-header {
  background: #1e1e1e;
  border-bottom: 1px solid #555;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: grab;
  user-select: none;
}

.panel-header:active {
  cursor: grabbing;
}

.panel-drag-handle {
  font-size: 18px;
  color: #888;
  cursor: grab;
}

.panel-title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.panel-controls {
  display: flex;
  gap: 4px;
}

.panel-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  color: #e0e0e0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.panel-btn:hover {
  background: #444;
}

.panel-close:hover {
  background: #ff5555;
}

/* Panel Actions */
.panel-actions {
  padding: 10px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #555;
  display: flex;
  gap: 8px;
}

.panel-btn-secondary,
.panel-btn-danger {
  flex: 1;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: opacity 0.2s;
}

.panel-btn-secondary {
  background: #4a90e2;
  color: white;
}

.panel-btn-secondary:hover {
  opacity: 0.8;
}

.panel-btn-danger {
  background: #f44336;
  color: white;
}

.panel-btn-danger:hover {
  opacity: 0.8;
}

/* Panel Stats */
.panel-stats {
  padding: 8px 12px;
  background: #1e1e1e;
  border-bottom: 1px solid #555;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #999;
}

/* Containers List */
.panel-containers-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
}

/* Container Section */
.panel-container-section {
  margin-bottom: 16px;
}

.panel-container-header {
  padding: 8px 12px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  background: #1e1e1e;
  border-top: 1px solid #555;
  border-bottom: 1px solid #555;
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-container-icon {
  font-size: 14px;
}

.panel-container-count {
  margin-left: auto;
  font-weight: normal;
  color: #999;
  font-size: 11px;
}

/* Quick Tab Items */
.panel-quick-tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #555;
  transition: background 0.2s;
  cursor: pointer;
}

.panel-quick-tab-item:hover {
  background: #3a3a3a;
}

.panel-quick-tab-item.active {
  border-left: 3px solid #4CAF50;
  padding-left: 9px;
}

.panel-quick-tab-item.minimized {
  border-left: 3px solid #FFC107;
  padding-left: 9px;
}

.panel-status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.panel-status-indicator.green {
  background: #4CAF50;
}

.panel-status-indicator.yellow {
  background: #FFC107;
}

.panel-favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.panel-tab-info {
  flex: 1;
  min-width: 0;
}

.panel-tab-title {
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-tab-meta {
  font-size: 10px;
  color: #999;
  margin-top: 2px;
}

.panel-tab-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.panel-btn-icon {
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

.panel-btn-icon:hover {
  background: #555;
}

/* Empty State */
.panel-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: #999;
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

/* Resize Handles */
.panel-resize-handle {
  position: absolute;
  z-index: 10;
}

.panel-resize-handle.n { top: 0; left: 10px; right: 10px; height: 10px; cursor: n-resize; }
.panel-resize-handle.s { bottom: 0; left: 10px; right: 10px; height: 10px; cursor: s-resize; }
.panel-resize-handle.e { right: 0; top: 10px; bottom: 10px; width: 10px; cursor: e-resize; }
.panel-resize-handle.w { left: 0; top: 10px; bottom: 10px; width: 10px; cursor: w-resize; }
.panel-resize-handle.ne { top: 0; right: 0; width: 10px; height: 10px; cursor: ne-resize; }
.panel-resize-handle.nw { top: 0; left: 0; width: 10px; height: 10px; cursor: nw-resize; }
.panel-resize-handle.se { bottom: 0; right: 0; width: 10px; height: 10px; cursor: se-resize; }
.panel-resize-handle.sw { bottom: 0; left: 0; width: 10px; height: 10px; cursor: sw-resize; }

/* Scrollbar Styling */
.panel-containers-list::-webkit-scrollbar {
  width: 8px;
}

.panel-containers-list::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.panel-containers-list::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 4px;
}

.panel-containers-list::-webkit-scrollbar-thumb:hover {
  background: #666;
}
`;
// ==================== END QUICK TABS MANAGER PANEL HTML/CSS ====================
```

#### Step 2.2: Add Panel Creation Function

**ADD to `content.js` (after the HTML/CSS templates):**

```javascript
// ==================== QUICK TABS MANAGER PANEL INJECTION ====================
// State
let quickTabsPanel = null;
let isPanelOpen = false;
let panelState = {
  left: 20,
  top: 100,
  width: 350,
  height: 500,
  isOpen: false
};

/**
 * Create and inject the Quick Tabs Manager panel into the page
 */
function createQuickTabsPanel() {
  // Check if panel already exists
  if (quickTabsPanel) {
    debug('[Panel] Panel already exists');
    return;
  }

  // Inject CSS
  const style = document.createElement('style');
  style.id = 'quick-tabs-manager-panel-styles';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);

  // Create panel container
  const container = document.createElement('div');
  container.innerHTML = PANEL_HTML;
  const panel = container.firstElementChild;

  // Load saved panel state from storage
  browser.storage.local.get('quick_tabs_panel_state').then(result => {
    if (result && result.quick_tabs_panel_state) {
      panelState = { ...panelState, ...result.quick_tabs_panel_state };

      // Apply saved position and size
      panel.style.left = panelState.left + 'px';
      panel.style.top = panelState.top + 'px';
      panel.style.width = panelState.width + 'px';
      panel.style.height = panelState.height + 'px';

      // Show panel if it was open before
      if (panelState.isOpen) {
        panel.style.display = 'flex';
        isPanelOpen = true;
      }
    }
  });

  // Append to body
  document.documentElement.appendChild(panel);
  quickTabsPanel = panel;

  // Make draggable
  const header = panel.querySelector('.panel-header');
  makePanelDraggable(panel, header);

  // Make resizable
  makePanelResizable(panel);

  // Setup panel event listeners
  setupPanelEventListeners(panel);

  // Initialize panel content
  updatePanelContent();

  // Auto-refresh every 2 seconds
  setInterval(updatePanelContent, 2000);

  debug('[Panel] Quick Tabs Manager panel created and injected');
}

/**
 * Toggle panel visibility
 */
function toggleQuickTabsPanel() {
  if (!quickTabsPanel) {
    createQuickTabsPanel();
  }

  if (isPanelOpen) {
    // Hide panel
    quickTabsPanel.style.display = 'none';
    isPanelOpen = false;
    panelState.isOpen = false;
  } else {
    // Show panel
    quickTabsPanel.style.display = 'flex';
    isPanelOpen = true;
    panelState.isOpen = true;

    // Bring to front
    quickTabsPanel.style.zIndex = '999999999';

    // Update content immediately
    updatePanelContent();
  }

  // Save state
  savePanelState();

  debug(`[Panel] Panel toggled: ${isPanelOpen ? 'OPEN' : 'CLOSED'}`);
}

/**
 * Save panel state to browser.storage.local
 */
function savePanelState() {
  if (!quickTabsPanel) return;

  const rect = quickTabsPanel.getBoundingClientRect();

  panelState = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    isOpen: isPanelOpen
  };

  browser.storage.local.set({ quick_tabs_panel_state: panelState }).catch(err => {
    debug('[Panel] Error saving panel state:', err);
  });
}
// ==================== END QUICK TABS MANAGER PANEL INJECTION ====================
```

---

### Phase 3: Drag & Resize Implementation

#### Step 3.1: Panel Drag Function

**ADD to `content.js`:**

```javascript
// ==================== PANEL DRAG IMPLEMENTATION ====================
/**
 * Make panel draggable using Pointer Events API
 * @param {HTMLElement} panel - The panel container
 * @param {HTMLElement} handle - The drag handle (header)
 */
function makePanelDraggable(panel, handle) {
  let isDragging = false;
  let offsetX = 0,
    offsetY = 0;
  let currentPointerId = null;

  const handlePointerDown = e => {
    if (e.button !== 0) return; // Only left click
    if (e.target.classList.contains('panel-btn')) return; // Ignore buttons

    isDragging = true;
    currentPointerId = e.pointerId;

    // Capture pointer
    handle.setPointerCapture(e.pointerId);

    // Calculate offset
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    handle.style.cursor = 'grabbing';
    e.preventDefault();
  };

  const handlePointerMove = e => {
    if (!isDragging || e.pointerId !== currentPointerId) return;

    // Calculate new position
    const newLeft = e.clientX - offsetX;
    const newTop = e.clientY - offsetY;

    // Apply position
    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';

    e.preventDefault();
  };

  const handlePointerUp = e => {
    if (!isDragging || e.pointerId !== currentPointerId) return;

    isDragging = false;
    handle.releasePointerCapture(e.pointerId);
    handle.style.cursor = 'grab';

    // Save final position
    savePanelState();
  };

  const handlePointerCancel = e => {
    if (!isDragging) return;

    isDragging = false;
    handle.style.cursor = 'grab';

    // Save position
    savePanelState();
  };

  // Attach listeners
  handle.addEventListener('pointerdown', handlePointerDown);
  handle.addEventListener('pointermove', handlePointerMove);
  handle.addEventListener('pointerup', handlePointerUp);
  handle.addEventListener('pointercancel', handlePointerCancel);
}
// ==================== END PANEL DRAG IMPLEMENTATION ====================
```

#### Step 3.2: Panel Resize Function

**ADD to `content.js`:**

```javascript
// ==================== PANEL RESIZE IMPLEMENTATION ====================
/**
 * Make panel resizable from all edges/corners
 * @param {HTMLElement} panel - The panel container
 */
function makePanelResizable(panel) {
  const minWidth = 250;
  const minHeight = 300;
  const handleSize = 10;

  // Define resize handles
  const handles = {
    n: { cursor: 'n-resize', top: 0, left: handleSize, right: handleSize, height: handleSize },
    s: { cursor: 's-resize', bottom: 0, left: handleSize, right: handleSize, height: handleSize },
    e: { cursor: 'e-resize', right: 0, top: handleSize, bottom: handleSize, width: handleSize },
    w: { cursor: 'w-resize', left: 0, top: handleSize, bottom: handleSize, width: handleSize },
    ne: { cursor: 'ne-resize', top: 0, right: 0, width: handleSize, height: handleSize },
    nw: { cursor: 'nw-resize', top: 0, left: 0, width: handleSize, height: handleSize },
    se: { cursor: 'se-resize', bottom: 0, right: 0, width: handleSize, height: handleSize },
    sw: { cursor: 'sw-resize', bottom: 0, left: 0, width: handleSize, height: handleSize }
  };

  Object.entries(handles).forEach(([direction, style]) => {
    const handle = document.createElement('div');
    handle.className = `panel-resize-handle ${direction}`;
    handle.style.cssText = `
      position: absolute;
      ${style.top !== undefined ? `top: ${style.top}px;` : ''}
      ${style.bottom !== undefined ? `bottom: ${style.bottom}px;` : ''}
      ${style.left !== undefined ? `left: ${style.left}px;` : ''}
      ${style.right !== undefined ? `right: ${style.right}px;` : ''}
      ${style.width ? `width: ${style.width}px;` : ''}
      ${style.height ? `height: ${style.height}px;` : ''}
      cursor: ${style.cursor};
      z-index: 10;
    `;

    let isResizing = false;
    let currentPointerId = null;
    let startX, startY, startWidth, startHeight, startLeft, startTop;

    const handlePointerDown = e => {
      if (e.button !== 0) return;

      isResizing = true;
      currentPointerId = e.pointerId;
      handle.setPointerCapture(e.pointerId);

      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      startLeft = rect.left;
      startTop = rect.top;

      e.preventDefault();
      e.stopPropagation();
    };

    const handlePointerMove = e => {
      if (!isResizing || e.pointerId !== currentPointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newLeft = startLeft;
      let newTop = startTop;

      // Calculate new dimensions based on direction
      if (direction.includes('e')) {
        newWidth = Math.max(minWidth, startWidth + dx);
      }
      if (direction.includes('w')) {
        const maxDx = startWidth - minWidth;
        const constrainedDx = Math.min(dx, maxDx);
        newWidth = startWidth - constrainedDx;
        newLeft = startLeft + constrainedDx;
      }
      if (direction.includes('s')) {
        newHeight = Math.max(minHeight, startHeight + dy);
      }
      if (direction.includes('n')) {
        const maxDy = startHeight - minHeight;
        const constrainedDy = Math.min(dy, maxDy);
        newHeight = startHeight - constrainedDy;
        newTop = startTop + constrainedDy;
      }

      // Apply new dimensions
      panel.style.width = newWidth + 'px';
      panel.style.height = newHeight + 'px';
      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';

      e.preventDefault();
    };

    const handlePointerUp = e => {
      if (!isResizing || e.pointerId !== currentPointerId) return;

      isResizing = false;
      handle.releasePointerCapture(e.pointerId);

      // Save final size/position
      savePanelState();
    };

    const handlePointerCancel = e => {
      if (!isResizing) return;

      isResizing = false;
      savePanelState();
    };

    // Attach listeners
    handle.addEventListener('pointerdown', handlePointerDown);
    handle.addEventListener('pointermove', handlePointerMove);
    handle.addEventListener('pointerup', handlePointerUp);
    handle.addEventListener('pointercancel', handlePointerCancel);

    panel.appendChild(handle);
  });
}
// ==================== END PANEL RESIZE IMPLEMENTATION ====================
```

---

### Phase 4: Panel Content & Event Listeners

#### Step 4.1: Panel Event Listeners

**ADD to `content.js`:**

```javascript
// ==================== PANEL EVENT LISTENERS ====================
/**
 * Setup event listeners for panel buttons and interactions
 * @param {HTMLElement} panel - The panel container
 */
function setupPanelEventListeners(panel) {
  // Close button
  const closeBtn = panel.querySelector('.panel-close');
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleQuickTabsPanel(); // Close panel
  });

  // Minimize button (same as close for now)
  const minimizeBtn = panel.querySelector('.panel-minimize');
  minimizeBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleQuickTabsPanel(); // Hide panel
  });

  // Close Minimized button
  const closeMinimizedBtn = panel.querySelector('#panel-closeMinimized');
  closeMinimizedBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await closeMinimizedTabsFromPanel();
  });

  // Close All button
  const closeAllBtn = panel.querySelector('#panel-closeAll');
  closeAllBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await closeAllTabsFromPanel();
  });

  // Delegated listener for Quick Tab item actions
  const containersList = panel.querySelector('#panel-containersList');
  containersList.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;

    e.stopPropagation();

    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;

    switch (action) {
      case 'goToTab':
        await browser.tabs.update(parseInt(tabId), { active: true });
        break;
      case 'minimize':
        await minimizeQuickTabFromPanel(quickTabId);
        break;
      case 'restore':
        await restoreQuickTabFromPanel(quickTabId);
        break;
      case 'close':
        await closeQuickTabFromPanel(quickTabId);
        break;
    }
  });
}

/**
 * Close minimized tabs from panel
 */
async function closeMinimizedTabsFromPanel() {
  try {
    const result = await browser.storage.sync.get('quick_tabs_state_v2');
    if (!result || !result.quick_tabs_state_v2) return;

    const state = result.quick_tabs_state_v2;
    let hasChanges = false;

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
      await browser.storage.sync.set({ quick_tabs_state_v2: state });
      debug('[Panel] Closed all minimized Quick Tabs');
    }
  } catch (err) {
    console.error('[Panel] Error closing minimized tabs:', err);
  }
}

/**
 * Close all tabs from panel
 */
async function closeAllTabsFromPanel() {
  try {
    await browser.storage.sync.remove('quick_tabs_state_v2');

    // Notify all tabs
    const tabs = await browser.tabs.query({});
    tabs.forEach(tab => {
      browser.tabs
        .sendMessage(tab.id, {
          action: 'CLEAR_ALL_QUICK_TABS'
        })
        .catch(() => {});
    });

    debug('[Panel] Closed all Quick Tabs');
  } catch (err) {
    console.error('[Panel] Error closing all tabs:', err);
  }
}

/**
 * Minimize Quick Tab from panel
 */
async function minimizeQuickTabFromPanel(quickTabId) {
  const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);
  if (container) {
    const iframe = container.querySelector('iframe');
    const url = iframe?.src || iframe?.getAttribute('data-deferred-src');
    const titleEl = container.querySelector('.copy-url-quicktab-titlebar span');
    const title = titleEl?.textContent || 'Quick Tab';

    minimizeQuickTab(container, url, title);
  }
}

/**
 * Restore Quick Tab from panel
 */
async function restoreQuickTabFromPanel(quickTabId) {
  restoreQuickTab(quickTabId);
}

/**
 * Close Quick Tab from panel
 */
async function closeQuickTabFromPanel(quickTabId) {
  const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);
  if (container) {
    closeQuickTabWindow(container);
  }
}
// ==================== END PANEL EVENT LISTENERS ====================
```

#### Step 4.2: Panel Content Update

**ADD to `content.js`:**

```javascript
// ==================== PANEL CONTENT UPDATE ====================
/**
 * Update panel content with current Quick Tabs state
 * Reuses logic from sidebar/quick-tabs-manager.js
 */
async function updatePanelContent() {
  if (!quickTabsPanel || !isPanelOpen) return;

  const totalTabsEl = quickTabsPanel.querySelector('#panel-totalTabs');
  const lastSyncEl = quickTabsPanel.querySelector('#panel-lastSync');
  const containersList = quickTabsPanel.querySelector('#panel-containersList');
  const emptyState = quickTabsPanel.querySelector('#panel-emptyState');

  // Load Quick Tabs state
  let quickTabsState = {};
  try {
    const result = await browser.storage.sync.get('quick_tabs_state_v2');
    if (result && result.quick_tabs_state_v2) {
      quickTabsState = result.quick_tabs_state_v2;
    }
  } catch (err) {
    debug('[Panel] Error loading Quick Tabs state:', err);
    return;
  }

  // Calculate totals
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

  // Load container info
  let containersData = {};
  try {
    if (typeof browser.contextualIdentities !== 'undefined') {
      const containers = await browser.contextualIdentities.query({});
      containers.forEach(container => {
        containersData[container.cookieStoreId] = {
          name: container.name,
          icon: getContainerIconForPanel(container.icon),
          color: container.color
        };
      });
    }

    // Always add default container
    containersData['firefox-default'] = {
      name: 'Default',
      icon: '📁',
      color: 'grey'
    };
  } catch (err) {
    debug('[Panel] Error loading container info:', err);
  }

  // Clear and rebuild containers list
  containersList.innerHTML = '';

  // Sort containers
  const sortedContainers = Object.keys(containersData).sort((a, b) => {
    if (a === 'firefox-default') return -1;
    if (b === 'firefox-default') return 1;
    return containersData[a].name.localeCompare(containersData[b].name);
  });

  sortedContainers.forEach(cookieStoreId => {
    const containerInfo = containersData[cookieStoreId];
    const containerState = quickTabsState[cookieStoreId];

    if (!containerState || !containerState.tabs || containerState.tabs.length === 0) {
      return; // Skip empty containers
    }

    renderPanelContainerSection(containersList, cookieStoreId, containerInfo, containerState);
  });
}

/**
 * Get container icon for panel (emoji)
 */
function getContainerIconForPanel(icon) {
  const iconMap = {
    fingerprint: '🔒',
    briefcase: '💼',
    dollar: '💰',
    cart: '🛒',
    circle: '⭕',
    gift: '🎁',
    vacation: '🏖️',
    food: '🍴',
    fruit: '🍎',
    pet: '🐾',
    tree: '🌳',
    chill: '❄️',
    fence: '🚧'
  };
  return iconMap[icon] || '📁';
}

/**
 * Render container section in panel
 */
function renderPanelContainerSection(containersList, cookieStoreId, containerInfo, containerState) {
  const section = document.createElement('div');
  section.className = 'panel-container-section';

  // Header
  const header = document.createElement('h3');
  header.className = 'panel-container-header';
  header.innerHTML = `
    <span class="panel-container-icon">${containerInfo.icon}</span>
    <span class="panel-container-name">${containerInfo.name}</span>
    <span class="panel-container-count">(${containerState.tabs.length} tab${containerState.tabs.length !== 1 ? 's' : ''})</span>
  `;

  section.appendChild(header);

  // Tabs
  const activeTabs = containerState.tabs.filter(t => !t.minimized);
  const minimizedTabs = containerState.tabs.filter(t => t.minimized);

  activeTabs.forEach(tab => {
    section.appendChild(renderPanelQuickTabItem(tab, false));
  });

  minimizedTabs.forEach(tab => {
    section.appendChild(renderPanelQuickTabItem(tab, true));
  });

  containersList.appendChild(section);
}

/**
 * Render Quick Tab item in panel
 */
function renderPanelQuickTabItem(tab, isMinimized) {
  const item = document.createElement('div');
  item.className = `panel-quick-tab-item ${isMinimized ? 'minimized' : 'active'}`;

  // Indicator
  const indicator = document.createElement('span');
  indicator.className = `panel-status-indicator ${isMinimized ? 'yellow' : 'green'}`;

  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'panel-favicon';
  try {
    const urlObj = new URL(tab.url);
    favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    favicon.onerror = () => (favicon.style.display = 'none');
  } catch (e) {
    favicon.style.display = 'none';
  }

  // Info
  const info = document.createElement('div');
  info.className = 'panel-tab-info';

  const title = document.createElement('div');
  title.className = 'panel-tab-title';
  title.textContent = tab.title || 'Quick Tab';

  const meta = document.createElement('div');
  meta.className = 'panel-tab-meta';

  let metaParts = [];
  if (isMinimized) metaParts.push('Minimized');
  if (tab.activeTabId) metaParts.push(`Tab ${tab.activeTabId}`);
  if (tab.width && tab.height) metaParts.push(`${Math.round(tab.width)}×${Math.round(tab.height)}`);
  meta.textContent = metaParts.join(' • ');

  info.appendChild(title);
  info.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'panel-tab-actions';

  if (!isMinimized) {
    // Go to Tab button
    if (tab.activeTabId) {
      const goToBtn = document.createElement('button');
      goToBtn.className = 'panel-btn-icon';
      goToBtn.textContent = '🔗';
      goToBtn.title = 'Go to Tab';
      goToBtn.dataset.action = 'goToTab';
      goToBtn.dataset.tabId = tab.activeTabId;
      actions.appendChild(goToBtn);
    }

    // Minimize button
    const minBtn = document.createElement('button');
    minBtn.className = 'panel-btn-icon';
    minBtn.textContent = '➖';
    minBtn.title = 'Minimize';
    minBtn.dataset.action = 'minimize';
    minBtn.dataset.quickTabId = tab.id;
    actions.appendChild(minBtn);
  } else {
    // Restore button
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'panel-btn-icon';
    restoreBtn.textContent = '↑';
    restoreBtn.title = 'Restore';
    restoreBtn.dataset.action = 'restore';
    restoreBtn.dataset.quickTabId = tab.id;
    actions.appendChild(restoreBtn);
  }

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'panel-btn-icon';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.dataset.action = 'close';
  closeBtn.dataset.quickTabId = tab.id;
  actions.appendChild(closeBtn);

  // Assemble
  item.appendChild(indicator);
  item.appendChild(favicon);
  item.appendChild(info);
  item.appendChild(actions);

  return item;
}
// ==================== END PANEL CONTENT UPDATE ====================
```

---

### Phase 5: Message Handler & Initialization

#### Step 5.1: Add Message Handler

**ADD to existing `browser.runtime.onMessage.addListener` in `content.js`:**

```javascript
// Runtime message listener - ADD this new case
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ... existing cases ...

  // NEW: Handle toggle panel command from background script
  if (message.action === 'TOGGLE_QUICK_TABS_PANEL') {
    toggleQuickTabsPanel();
    sendResponse({ success: true });
    return true;
  }

  return true;
});
```

#### Step 5.2: Initialize Panel on Page Load

**ADD to end of `content.js`:**

```javascript
// ==================== INITIALIZE PANEL ON PAGE LOAD ====================
// Create panel when page loads (hidden by default)
// Panel will be shown when user presses Ctrl+Alt+Z
window.addEventListener('load', () => {
  // Small delay to ensure page is fully loaded
  setTimeout(() => {
    createQuickTabsPanel();
  }, 500);
});
// ==================== END INITIALIZE PANEL ====================
```

---

## 5. Testing & Validation

### Test Case 1: Panel Creation & Toggle

1. **Load extension** in Zen Browser
2. **Navigate to any webpage**
3. **Press `Ctrl+Alt+Z`**
4. ✅ Panel should appear in top-right corner
5. **Press `Ctrl+Alt+Z` again**
6. ✅ Panel should hide

### Test Case 2: Drag Functionality

1. **Open panel** (`Ctrl+Alt+Z`)
2. **Click and drag** the header bar
3. ✅ Panel should move smoothly
4. **Release mouse**
5. ✅ Panel position should be saved
6. **Reload page** and open panel
7. ✅ Panel should appear at last saved position

### Test Case 3: Resize Functionality

1. **Open panel**
2. **Drag bottom-right corner** to resize
3. ✅ Panel should resize smoothly
4. ✅ Minimum size constraints should apply (250×300)
5. **Reload page** and open panel
6. ✅ Panel should have saved size

### Test Case 4: Quick Tabs Display

1. **Create Quick Tab** (press Q over link)
2. **Open panel** (`Ctrl+Alt+Z`)
3. ✅ Quick Tab should appear with green indicator
4. **Minimize Quick Tab** from panel
5. ✅ Indicator should change to yellow
6. **Restore Quick Tab** from panel
7. ✅ Quick Tab should reappear

### Test Case 5: Container Tab Separation

1. **Create Quick Tab in Personal container**
2. **Create Quick Tab in Work container**
3. **Open panel**
4. ✅ Quick Tabs should be categorized by container
5. ✅ Container icons and names should display

### Test Case 6: Panel Persistence

1. **Open panel**, resize and move it
2. **Navigate to different page**
3. **Open panel** (`Ctrl+Alt+Z`)
4. ✅ Panel should remember position and size
5. ✅ Panel should auto-update with current Quick Tabs

### Test Case 7: Close Buttons

1. **Create 3 Quick Tabs** (2 active, 1 minimized)
2. **Open panel**
3. **Click "Close Minimized"**
4. ✅ Only minimized tab should close
5. **Click "Close All"**
6. ✅ All Quick Tabs should close

---

## 6. Migration Notes

### Compatibility

- ✅ Works in **Zen Browser** (sidebar disabled)
- ✅ Works in **Firefox** (panel replaces sidebar)
- ✅ No data migration needed (uses same storage schema)

### User Experience Changes

| Feature     | Sidebar (v1.5.8)      | Panel (v1.5.9)         |
| ----------- | --------------------- | ---------------------- |
| Activation  | Native sidebar toggle | Keyboard shortcut only |
| Position    | Fixed left/right edge | Draggable anywhere     |
| Persistence | Browser-managed       | Extension-managed      |
| Resize      | Browser-managed       | User-controlled        |

---

## 7. Known Limitations

### Limitation 1: Z-Index Conflicts

**Issue:** Very rare pages with extremely high z-index elements may overlap panel.

**Solution:** Panel uses `z-index: 999999999` (highest practical value).

### Limitation 2: CSP Restrictions

**Issue:** Pages with strict Content Security Policy may block inline styles.

**Solution:** Styles are injected as `<style>` element, which CSP usually allows.

### Limitation 3: Panel Not Available on Restricted Pages

**Issue:** Panel cannot be injected on `about:`, `chrome:`, `moz-extension:` pages.

**Workaround:** Extension already checks for restricted pages (same as Quick Tabs).

---

## 8. Future Enhancements

### Enhancement 1: Multi-Monitor Support

Save panel position per monitor (detect screen bounds).

### Enhancement 2: Snap-to-Edge

Allow panel to "dock" to screen edges like a sidebar.

### Enhancement 3: Opacity Control

Add transparency slider for panel background.

---

## 9. Document Changelog

| Version | Date       | Changes                                                     |
| ------- | ---------- | ----------------------------------------------------------- |
| 1.0.0   | 2025-11-11 | Initial document - Persistent floating panel implementation |

---

## 10. References

- [Pointer Events API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [browser.commands API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/commands)
- [browser.storage.local](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local)
- [Extension Repository](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition)

---

**END OF DOCUMENT**

This implementation provides a complete, production-ready solution for a persistent, draggable, resizable Quick Tabs Manager panel that works in Zen Browser where the native Firefox sidebar is disabled.
