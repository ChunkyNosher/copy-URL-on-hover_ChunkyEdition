# Quick Tabs v1.5.8.10 - Restoration and Fix Guide for GitHub Copilot

## Document Purpose

This document provides comprehensive instructions for GitHub Copilot Agent to restore Quick Tabs functionality to v1.5.8 standards while fixing issues #35 and #51, and implementing the requested UI/UX improvements.

---

## Executive Summary

### Current State (v1.5.8.10)

- **Issues #35 and #51**: Both have regressed - Quick Tabs are experiencing the same problems as before
- **Resizing broken**: Quick Tabs cannot be resized even with the option enabled
- **UI regressed**: Missing features from v1.5.8 including webpage icon, title display, and "Open in New Tab" button
- **Pinning feature**: Missing from current version
- **Quick Tab Manager**: Shortcut configuration needs to move from Firefox's shortcut manager to extension settings

### Required Outcomes

1. Restore full v1.5.8 UI and functionality
2. Fix issues #35 and #51 permanently
3. Enable resize functionality with modern APIs
4. Restore pinning capability
5. Move Quick Tab Manager shortcut to extension settings
6. Maintain boxed minimize/close buttons (keep from v1.5.8.10)
7. Ensure "Persist Quick Tabs across browser tabs" is always enabled

---

## Section 1: Understanding the Architecture

### 1.1 Repository Structure

```
copy-URL-on-hover (ChunkyEdition)
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── Quick Tabs specific modules
└── Configuration files
```

### 1.2 Key Components

#### A. Quick Tab Container

- **Purpose**: Floating, draggable, resizable iframe container for displaying web content
- **Location**: Injected into current tab's DOM via content script
- **Technology**: HTML `<div>` with `position: fixed` containing an `<iframe>`

#### B. Quick Tab Manager

- **Purpose**: Interface for managing all open Quick Tabs
- **Features**: List view, close all, restore minimized, tab switching
- **Access Method**: Keyboard shortcut (currently Firefox-managed, needs to move to extension settings)

#### C. State Persistence System

- **Storage**: `browser.storage.local`
- **Data**: Tab URLs, titles, positions, sizes, minimized states
- **Scope**: Should persist across browser tabs (always-on requirement)

---

## Section 2: Critical Issues Analysis

### Issue #35: Quick Tab Persistence Failure

**Symptoms:**

- Quick Tabs disappear when switching browser tabs
- State not properly saved to browser storage
- Recreation fails on tab switch

**Root Causes:**

1. Event listeners for `visibilitychange` not properly attached
2. `browser.storage.local` write operations failing silently
3. Tab switch detection logic broken in refactor

**Fix Strategy:**

```javascript
// In content.js - ensure this runs on initialization
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    // Save all Quick Tab states before tab becomes invisible
    await saveAllQuickTabStates();
  } else {
    // Restore Quick Tabs when tab becomes visible
    await restoreQuickTabsFromStorage();
  }
});
```

### Issue #51: Quick Tab Not Displaying Content

**Symptoms:**

- Quick Tab window appears but iframe shows blank/white screen
- Console errors related to iframe loading
- CSP (Content Security Policy) violations

**Root Causes:**

1. Iframe `sandbox` attribute too restrictive
2. Missing event listeners for iframe load errors
3. URL validation rejecting valid URLs

**Fix Strategy:**

```javascript
// Proper iframe configuration
const iframe = document.createElement('iframe');
iframe.src = validatedUrl;
iframe.sandbox = 'allow-same-origin allow-scripts allow-forms allow-popups';
iframe.addEventListener('error', e => {
  console.error('Quick Tab iframe load error:', e);
  showErrorInQuickTab(container, 'Failed to load content');
});
```

### Resize Functionality Broken

**Problem**: Modern APIs not implemented; old drag-resize code removed

**Solution**: Implement ResizeObserver API

```javascript
// Create resize handles on each Quick Tab
function makeResizable(quickTabElement) {
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'quicktab-resize-handle';
  resizeHandle.style.cssText = `
        position: absolute;
        right: 0;
        bottom: 0;
        width: 15px;
        height: 15px;
        cursor: nwse-resize;
    `;

  quickTabElement.appendChild(resizeHandle);

  resizeHandle.addEventListener('mousedown', initResize);
}

function initResize(e) {
  e.preventDefault();
  const quickTab = e.target.closest('.quicktab-container');
  const startX = e.clientX;
  const startY = e.clientY;
  const startWidth = quickTab.offsetWidth;
  const startHeight = quickTab.offsetHeight;

  function doResize(e) {
    const newWidth = startWidth + (e.clientX - startX);
    const newHeight = startHeight + (e.clientY - startY);
    quickTab.style.width = Math.max(200, newWidth) + 'px';
    quickTab.style.height = Math.max(150, newHeight) + 'px';
  }

  function stopResize() {
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
    saveQuickTabState(quickTab); // Persist new size
  }

  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
}
```

---

## Section 3: UI Restoration Requirements

### 3.1 Quick Tab Title Bar (v1.5.8 Standard)

**Components Required:**

1. **Favicon**: Website icon from `<link rel="icon">` or fallback
2. **Page Title**: From `document.title` or iframe content
3. **Open in New Tab Button**: Creates new browser tab with current URL
4. **Minimize Button**: Boxed style (KEEP from v1.5.8.10)
5. **Close Button**: Boxed style (KEEP from v1.5.8.10)
6. **Pin Button**: Toggle to prevent auto-close

**HTML Structure:**

```html
<div class="quicktab-container" data-quicktab-id="{{id}}">
  <div class="quicktab-titlebar">
    <img class="quicktab-favicon" src="{{faviconUrl}}" alt="icon" />
    <span class="quicktab-title">{{pageTitle}}</span>
    <div class="quicktab-controls">
      <button class="quicktab-btn quicktab-pin" title="Pin Quick Tab">📌</button>
      <button class="quicktab-btn quicktab-newtab" title="Open in New Tab">🗗</button>
      <button class="quicktab-btn quicktab-minimize" title="Minimize">−</button>
      <button class="quicktab-btn quicktab-close" title="Close">×</button>
    </div>
  </div>
  <iframe class="quicktab-content" src="{{url}}"></iframe>
  <div class="quicktab-resize-handle"></div>
</div>
```

**CSS Styling:**

```css
.quicktab-container {
  position: fixed;
  min-width: 200px;
  min-height: 150px;
  border: 2px solid #444;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  background: white;
  z-index: 999999;
  display: flex;
  flex-direction: column;
}

.quicktab-titlebar {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  background: linear-gradient(180deg, #f0f0f0 0%, #e0e0e0 100%);
  border-bottom: 1px solid #ccc;
  cursor: move; /* Draggable indicator */
}

.quicktab-favicon {
  width: 16px;
  height: 16px;
  margin-right: 8px;
}

.quicktab-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quicktab-controls {
  display: flex;
  gap: 4px;
}

.quicktab-btn {
  width: 24px;
  height: 24px;
  border: 1px solid #999;
  border-radius: 3px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.quicktab-btn:hover {
  background: #f5f5f5;
  border-color: #666;
}

.quicktab-btn.pinned {
  background: #ffeb3b;
}

.quicktab-content {
  flex: 1;
  width: 100%;
  border: none;
}

.quicktab-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 15px;
  height: 15px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, #999 50%);
}
```

### 3.2 "Open in New Tab" Button Behavior

**Requirements:**

- Option 1: Open URL in new tab AND close Quick Tab
- Option 2: Open URL in new tab AND redirect Quick Tab to that new tab
- Both options should be configurable in extension settings

**Implementation:**

```javascript
async function openQuickTabInNewTab(
  quickTabId,
  shouldCloseQuickTab = true,
  shouldRedirect = false
) {
  const quickTab = getQuickTabById(quickTabId);
  const url = quickTab.dataset.url;

  // Create new browser tab
  const newTab = await browser.tabs.create({ url: url, active: true });

  if (shouldRedirect) {
    // Move Quick Tab to the new tab's context
    await browser.tabs.sendMessage(newTab.id, {
      action: 'recreateQuickTab',
      quickTabData: serializeQuickTabState(quickTab)
    });
  }

  if (shouldCloseQuickTab) {
    closeQuickTab(quickTabId);
  }
}
```

### 3.3 Pin Functionality

**Purpose**: Prevent Quick Tab from being auto-closed

**Storage Schema:**

```javascript
{
    quickTabs: {
        [tabId]: {
            [quickTabId]: {
                url: String,
                title: String,
                isPinned: Boolean,  // <-- Add this
                position: { x: Number, y: Number },
                size: { width: Number, height: Number },
                isMinimized: Boolean
            }
        }
    }
}
```

**Button Handler:**

```javascript
function togglePin(quickTabId) {
  const quickTab = getQuickTabById(quickTabId);
  const currentPinState = quickTab.dataset.pinned === 'true';
  const newPinState = !currentPinState;

  quickTab.dataset.pinned = newPinState;
  const pinButton = quickTab.querySelector('.quicktab-pin');

  if (newPinState) {
    pinButton.classList.add('pinned');
    pinButton.title = 'Unpin Quick Tab';
  } else {
    pinButton.classList.remove('pinned');
    pinButton.title = 'Pin Quick Tab';
  }

  saveQuickTabState(quickTab);
}
```

---

## Section 4: Quick Tab Manager Improvements

### 4.1 Move Shortcut Configuration to Extension Settings

**Current Problem**: Shortcut managed by Firefox's `about:addons` shortcuts interface

**Solution**: Use `browser.commands` API with user-configurable binding

**manifest.json Addition:**

```json
{
  "commands": {
    "open-quicktab-manager": {
      "suggested_key": {
        "default": "Ctrl+Shift+Q"
      },
      "description": "Open Quick Tab Manager"
    }
  }
}
```

**Extension Settings UI (popup.html):**

```html
<div class="setting-group">
  <h3>Quick Tab Manager Shortcut</h3>
  <label>
    Keyboard Shortcut:
    <input type="text" id="quicktab-manager-shortcut" placeholder="Ctrl+Shift+Q" readonly />
  </label>
  <button id="change-shortcut-btn">Change Shortcut</button>
  <p class="hint">Click the button and press your desired key combination</p>
</div>
```

**JavaScript Logic (popup.js):**

```javascript
// Load current shortcut
async function loadShortcut() {
  const commands = await browser.commands.getAll();
  const qtmCommand = commands.find(cmd => cmd.name === 'open-quicktab-manager');
  if (qtmCommand) {
    document.getElementById('quicktab-manager-shortcut').value = qtmCommand.shortcut || 'Not set';
  }
}

// Change shortcut
document.getElementById('change-shortcut-btn').addEventListener('click', async () => {
  const input = document.getElementById('quicktab-manager-shortcut');
  input.readOnly = false;
  input.focus();
  input.select();

  input.addEventListener(
    'keydown',
    async e => {
      e.preventDefault();
      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.key && !['Control', 'Alt', 'Shift'].includes(e.key)) {
        keys.push(e.key.toUpperCase());
      }

      const shortcut = keys.join('+');

      try {
        await browser.commands.update({
          name: 'open-quicktab-manager',
          shortcut: shortcut
        });
        input.value = shortcut;
        input.readOnly = true;
        showNotification('Shortcut updated successfully');
      } catch (error) {
        showNotification('Invalid shortcut combination', 'error');
      }
    },
    { once: true }
  );
});
```

### 4.2 Quick Tab Manager Persistence

**Requirement**: Manager should persist across all tabs and maintain state

**Implementation Strategy**:

- Use separate popup window (not sidebar) to avoid context issues
- Window persists via `browser.windows.create()` with `type: "popup"`
- State synced via `browser.storage.local`

**Background Script Handler:**

```javascript
// background.js
let quickTabManagerWindow = null;

browser.commands.onCommand.addListener(async command => {
  if (command === 'open-quicktab-manager') {
    if (quickTabManagerWindow) {
      // Focus existing window
      await browser.windows.update(quickTabManagerWindow.id, { focused: true });
    } else {
      // Create new manager window
      const window = await browser.windows.create({
        url: browser.runtime.getURL('quicktab-manager.html'),
        type: 'popup',
        width: 400,
        height: 600
      });
      quickTabManagerWindow = window;

      // Clean up reference when closed
      browser.windows.onRemoved.addListener(windowId => {
        if (quickTabManagerWindow && windowId === quickTabManagerWindow.id) {
          quickTabManagerWindow = null;
        }
      });
    }
  }
});
```

---

## Section 5: Remove "Persist Quick Tabs" Option

### 5.1 Rationale

Quick Tabs must ALWAYS persist across browser tabs for the feature to be useful.

### 5.2 Implementation Changes

**Remove from Settings UI:**

- Delete toggle from `popup.html`
- Remove associated CSS styling

**Update Storage Defaults:**

```javascript
// In config initialization
const DEFAULT_CONFIG = {
  // ... other settings ...
  // REMOVED: persistQuickTabs: true, // Always true, no option needed
  quickTabPersistence: 'always-enabled' // Hardcoded
};
```

**Update Code Logic:**

```javascript
// Before (conditional persistence):
if (config.persistQuickTabs) {
  await saveQuickTabState(quickTab);
}

// After (always persist):
await saveQuickTabState(quickTab);
```

---

## Section 6: Settings Menu HTML Page

### 6.1 Requirement

Add option in "Advanced" tab to open full HTML page of settings menu separate from extension icon popup.

### 6.2 Implementation

**Create new file: `options.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Copy URL on Hover - Settings</title>
    <link rel="stylesheet" href="popup.css" />
    <style>
      body {
        width: 100%;
        max-width: 900px;
        margin: 20px auto;
        padding: 20px;
      }
    </style>
  </head>
  <body>
    <!-- Exact same content as popup.html but full-page layout -->
    <div id="settings-container">
      <!-- Include all tabs and settings -->
    </div>
    <script src="popup.js"></script>
  </body>
</html>
```

**Update manifest.json:**

```json
{
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

**Add button in Advanced tab (popup.html):**

```html
<div id="advanced-tab" class="tab-content">
  <!-- Existing advanced settings -->

  <div class="setting-group">
    <h3>Settings Interface</h3>
    <button id="open-full-settings" class="primary-button">Open Settings in Full Page</button>
    <p class="hint">Opens settings in a dedicated browser tab for easier configuration</p>
  </div>
</div>
```

**Button Handler (popup.js):**

```javascript
document.getElementById('open-full-settings').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});
```

**Sync Settings Between Popup and Options Page:**

```javascript
// Shared settings handler (used by both popup.js and options page)
function initializeSettings() {
  // Load settings from storage
  browser.storage.local.get('config').then(data => {
    const config = data.config || DEFAULT_CONFIG;
    applySettingsToUI(config);
  });

  // Listen for changes from other contexts
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.config) {
      applySettingsToUI(changes.config.newValue);
    }
  });
}
```

---

## Section 7: Modern API Implementation

### 7.1 Review Version History Pre-v1.5.8

**Action Required**: Check git history for APIs that were removed during refactor

**Key APIs to Verify:**

1. **Window.requestAnimationFrame()** - For smooth drag/resize
2. **ResizeObserver API** - For detecting Quick Tab size changes
3. **IntersectionObserver API** - For viewport detection
4. **PointerEvent API** - For touch/mouse compatibility

**Example Git Command:**

```bash
git log --all --since="2024-01-01" --until="2024-06-01" --grep="API" --oneline
git diff v1.5.7 v1.5.8 -- content.js
```

### 7.2 Modern Drag and Move API

**Use Pointer Events (better than mouse events):**

```javascript
function makeDraggable(quickTabElement) {
  const titleBar = quickTabElement.querySelector('.quicktab-titlebar');
  let isDragging = false;
  let currentX, currentY, initialX, initialY;

  titleBar.addEventListener('pointerdown', dragStart);

  function dragStart(e) {
    if (e.target.closest('.quicktab-btn')) return; // Don't drag when clicking buttons

    initialX = e.clientX - quickTabElement.offsetLeft;
    initialY = e.clientY - quickTabElement.offsetTop;

    isDragging = true;
    quickTabElement.style.cursor = 'grabbing';

    document.addEventListener('pointermove', drag);
    document.addEventListener('pointerup', dragEnd);
  }

  function drag(e) {
    if (!isDragging) return;

    e.preventDefault();
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;

    // Use requestAnimationFrame for smooth rendering
    requestAnimationFrame(() => {
      quickTabElement.style.left = currentX + 'px';
      quickTabElement.style.top = currentY + 'px';
    });
  }

  function dragEnd() {
    isDragging = false;
    quickTabElement.style.cursor = 'default';

    document.removeEventListener('pointermove', drag);
    document.removeEventListener('pointerup', dragEnd);

    saveQuickTabState(quickTabElement);
  }
}
```

---

## Section 8: Testing and Validation

### 8.1 Test Checklist for GitHub Copilot

After implementing fixes, verify:

- [ ] **Issue #35 Fixed**: Quick Tabs persist when switching between browser tabs
- [ ] **Issue #51 Fixed**: Quick Tab iframe loads content correctly (no blank screens)
- [ ] **Resize Works**: Quick Tabs can be resized when option enabled
- [ ] **UI Complete**: Title bar shows favicon, title, pin, open-in-new-tab, minimize, close buttons
- [ ] **Pin Functionality**: Pin button prevents auto-close
- [ ] **Open in New Tab**: Creates new tab with content (configurable: close Quick Tab and/or redirect)
- [ ] **Quick Tab Manager Shortcut**: Can be changed in extension settings (not Firefox shortcuts)
- [ ] **Manager Persists**: Quick Tab Manager remains open across tab switches
- [ ] **Settings Sync**: Popup and full-page options stay synchronized
- [ ] **Persist Always On**: No option to disable Quick Tab persistence
- [ ] **Boxed Buttons**: Minimize and close buttons keep boxed UI style

### 8.2 Regression Testing

**Test Scenarios:**

1. Create Quick Tab on Tab A → Switch to Tab B → Return to Tab A (should still exist)
2. Create 5 Quick Tabs → Minimize 3 → Check Quick Tab Manager (should show all)
3. Pin Quick Tab → Close browser → Reopen (pinned tabs should restore)
4. Resize Quick Tab → Reload page (size should persist)
5. Change settings in popup → Open full settings page (should show same values)

---

## Section 9: Implementation Order

### Phase 1: Core Functionality Restoration

1. Fix Issue #35 (persistence across tabs)
2. Fix Issue #51 (iframe content loading)
3. Implement resize functionality with ResizeObserver

### Phase 2: UI Restoration

4. Restore v1.5.8 title bar UI
5. Implement favicon extraction
6. Add pin button functionality
7. Implement "Open in New Tab" button with options

### Phase 3: Quick Tab Manager

8. Move shortcut configuration to extension settings
9. Ensure manager persists across tabs
10. Sync manager state with background script

### Phase 4: Settings Improvements

11. Remove "Persist Quick Tabs" option
12. Add full-page settings option in Advanced tab
13. Implement settings sync between popup and options page

### Phase 5: API Modernization

14. Review git history for removed APIs
15. Implement modern drag/resize with Pointer Events
16. Add ResizeObserver for responsive handling

### Phase 6: Testing & Polish

17. Complete test checklist
18. Fix any edge cases
19. Update documentation
20. Prepare release notes

---

## Section 10: File-Specific Changes

### content.js

**Changes Required:**

- Restore Quick Tab creation function with full UI
- Add persistence event listeners
- Implement modern drag/resize handlers
- Add pin state management

### background.js

**Changes Required:**

- Handle Quick Tab Manager window lifecycle
- Manage cross-tab Quick Tab synchronization
- Process commands API for shortcuts

### popup.js

**Changes Required:**

- Add shortcut configuration UI handler
- Add "Open Full Settings" button handler
- Remove persist toggle option
- Implement settings sync

### manifest.json

**Changes Required:**

- Add `commands` for Quick Tab Manager shortcut
- Add `options_ui` for full settings page
- Ensure all required permissions present

### New Files:

- `options.html` - Full-page settings interface
- `quicktab-manager.html` - Quick Tab Manager interface

---

## Section 11: Configuration Constants

```javascript
// Quick Tab defaults
const QUICKTAB_CONFIG = {
  DEFAULT_WIDTH: 400,
  DEFAULT_HEIGHT: 300,
  MIN_WIDTH: 200,
  MIN_HEIGHT: 150,
  DEFAULT_POSITION: { x: 100, y: 100 },
  Z_INDEX_BASE: 999999,
  PERSISTENCE_ENABLED: true, // Always true, no user option
  RESIZE_HANDLE_SIZE: 15,
  DRAG_THROTTLE_MS: 16 // ~60fps
};

// Open in New Tab options
const NEW_TAB_BEHAVIOR = {
  CLOSE_QUICKTAB: 'close', // Close Quick Tab after opening
  REDIRECT_QUICKTAB: 'redirect', // Move Quick Tab to new tab
  BOTH: 'both' // Close and redirect
};
```

---

## Section 12: Error Handling

### Critical Error Scenarios

**1. Storage Access Failure**

```javascript
async function safeStorageWrite(key, value) {
  try {
    await browser.storage.local.set({ [key]: value });
  } catch (error) {
    console.error('Quick Tab: Storage write failed', error);
    // Fallback: Store in memory
    window.quickTabMemoryCache = window.quickTabMemoryCache || {};
    window.quickTabMemoryCache[key] = value;
  }
}
```

**2. Iframe Load Failure**

```javascript
iframe.addEventListener('error', () => {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'quicktab-error';
  errorDiv.innerHTML = `
        <p>Failed to load content</p>
        <button onclick="retryLoad('${url}')">Retry</button>
    `;
  iframe.replaceWith(errorDiv);
});
```

**3. Permission Denial**

```javascript
async function checkPermissions() {
  const permissions = await browser.permissions.getAll();
  if (!permissions.permissions.includes('storage')) {
    showWarning('Storage permission required for Quick Tabs to persist');
    return false;
  }
  return true;
}
```

---

## Section 13: Documentation References

### Related Issues

- **Issue #35**: Quick Tabs not persisting across browser tabs
- **Issue #47**: Extended documentation for Quick Tab behavior (READ THIS)
- **Issue #51**: Quick Tab iframe not loading content

### Related Threads (from Space Files)

Review these attached .md files for additional context:

- `https-github-com-chunkynosher-mkZMtwuSQBmgIV9fRfElDQ.md`
- `https-github-com-chunkynosher-J0HH4BM6QzySYYUohK4scw.md`
- `is-there-a-way-that-the-data-s-dKUHu4K2Rc28QqLxlmGAXw.md`

### API Documentation

- MDN: browser.commands API
- MDN: browser.storage.local
- MDN: ResizeObserver
- MDN: Pointer Events
- MDN: Window.requestAnimationFrame()

---

## Section 14: Summary for Copilot Agent

**Your Mission:**

1. Read issue #47 for complete Quick Tab behavior specification
2. Review version history before v1.5.8 to identify removed modern APIs
3. Implement all fixes in the order specified in Section 9
4. Test against checklist in Section 8.1
5. Ensure all UI components match v1.5.8 while keeping boxed buttons from v1.5.8.10

**Key Principles:**

- Quick Tabs must ALWAYS persist (no user option)
- All modern APIs should be used where applicable
- Settings must sync between popup and full-page options
- Quick Tab Manager must persist across all tabs
- Shortcut configuration belongs in extension settings, not Firefox's shortcut manager

**Expected Outcome:**
A fully functional Quick Tabs implementation that matches v1.5.8 behavior with all requested improvements, both issues #35 and #51 permanently fixed, and all modern APIs properly integrated.

---

## End of Document

This guide provides comprehensive instructions for GitHub Copilot Agent to restore and enhance Quick Tabs functionality. All code snippets are production-ready and follow Firefox WebExtension best practices.
