# Comprehensive Implementation Plan: Quick Tabs & Quick Tab Manager in Zen Browser Split View

**Version**: v1.5.8.16+  
**Date**: November 14, 2025  
**Author**: Technical Analysis for copy-URL-on-hover Extension

---

## Executive Summary

This document provides a detailed implementation plan to modify the
copy-URL-on-hover extension (v1.5.8.16) to support advanced Quick Tab and Quick
Tab Manager behaviors in Zen Browser's Split View feature. The proposed changes
enable fine-grained control over Quick Tab visibility and Quick Tab Manager
positioning based on tab context (normal tabs vs. split view tabs) and user
focus.

### Key Requirements Summary

| Requirement | Behavior Description                                                            | Complexity |
| ----------- | ------------------------------------------------------------------------------- | ---------- |
| **R1**      | Quick Tabs opened in normal Tab 1 appear in Tab 2/3 but NOT in Split View Tab 1 | Medium     |
| **R2**      | Quick Tabs opened in Split View Tab 1-1 only appear in that specific split pane | High       |
| **R3**      | Quick Tab Manager follows focus in Split View (only visible in focused pane)    | High       |
| **R4**      | Quick Tab Manager position persists across tab/split view transitions           | Medium     |

### Implementation Feasibility

**Overall Assessment**: ✅ **FEASIBLE**

All requirements can be implemented using existing Firefox WebExtension APIs
combined with Zen Browser-specific DOM detection. The implementation requires:

- New state tracking for split view detection
- Enhanced broadcast filtering logic
- Focus-aware Quick Tab Manager visibility toggle
- Position persistence across browsing contexts

**Estimated Implementation**: 400-500 lines of new code, 150-200 lines of
modifications to existing functions.

---

## Table of Contents

1. [Terminology & Definitions](#terminology--definitions)
2. [Technical Architecture Overview](#technical-architecture-overview)
3. [Requirement Analysis](#requirement-analysis)
4. [Implementation Strategy](#implementation-strategy)
5. [Code Changes Detail](#code-changes-detail)
6. [Testing Plan](#testing-plan)
7. [Backward Compatibility](#backward-compatibility)
8. [Performance Considerations](#performance-considerations)
9. [Future Enhancements](#future-enhancements)

---

## Terminology & Definitions

### Tab Hierarchy in Zen Browser

```
Browser Window
│
├─ Tab 1 (Normal Tab)
│  └─ Single webpage (example.com)
│
├─ Tab 2 (Normal Tab)
│  └─ Single webpage (wikipedia.org)
│
└─ Split View Tab 1 (Split Tab)
   ├─ Split View Tab 1-1 (First pane)
   │  └─ Webpage (youtube.com)
   ├─ Split View Tab 1-2 (Second pane)
   │  └─ Webpage (reddit.com)
   ├─ Split View Tab 1-3 (Third pane)
   │  └─ Webpage (github.com)
   └─ Split View Tab 1-4 (Fourth pane)
      └─ Webpage (stackoverflow.com)
```

### Key Terms

- **Normal Tab**: Traditional browser tab with a single webpage (Tab 1, Tab 2,
  etc.)
- **Split View Tab**: Zen Browser tab containing multiple split panes (Split
  View Tab 1, Split View Tab 2, etc.)
- **Split Pane**: Individual webpage within a Split View Tab (Split View Tab
  1-1, 1-2, 1-3, 1-4)
- **Browser Tab ID**: Unique identifier assigned by Firefox to each browser tab
  (obtained via `browser.tabs.query()`)
- **Split Pane ID**: Custom identifier for distinguishing individual panes
  within a Split View Tab
- **Focus**: The split pane or tab that the user is currently interacting with
  (determined by `document.hasFocus()` or click events)

### Quick Tab Manager Terminology

- **Quick Tab Manager Panel**: Floating panel that displays all active and
  minimized Quick Tabs
- **Panel Position**: Coordinates (left, top) and dimensions (width, height) of
  the Quick Tab Manager panel
- **Relative Position**: Position of the panel relative to the viewport (e.g.,
  "top-right corner" = 90% viewport width, 5% viewport height)
- **Position Persistence**: Maintaining panel position when switching between
  tabs or split panes

---

## Technical Architecture Overview

### Current Architecture (v1.5.8.16)

```
┌─────────────────────────────────────────────────────────────┐
│  Browser Window (Firefox/Zen Browser)                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────┐                                  │
│  │  Normal Tab 1        │                                  │
│  │  (example.com)       │                                  │
│  │                      │                                  │
│  │  Content Script:     │                                  │
│  │  - quickTabWindows[] │                                  │
│  │  - tabInstanceId     │                                  │
│  │  - currentBrowserTabId                                  │
│  └──────────────────────┘                                  │
│           │                                                 │
│           │ BroadcastChannel                               │
│           │ browser.storage.sync                           │
│           │ browser.runtime.sendMessage                    │
│           ▼                                                 │
│  ┌──────────────────────┐                                  │
│  │  Normal Tab 2        │                                  │
│  │  (example.com)       │                                  │
│  │                      │                                  │
│  │  Content Script:     │                                  │
│  │  - Receives broadcast│                                  │
│  │  - Creates duplicate │  ◀── CURRENT BEHAVIOR            │
│  │    Quick Tab         │      (No split detection)        │
│  └──────────────────────┘                                  │
│                                                             │
│  Background Script:                                        │
│  - Coordinates cross-origin Quick Tab sync                 │
│  - Stores canonical state in browser.storage.sync         │
└─────────────────────────────────────────────────────────────┘
```

### Proposed Architecture (v1.5.9+)

```
┌─────────────────────────────────────────────────────────────┐
│  Browser Window (Zen Browser with Split View Support)      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────┐                                  │
│  │  Normal Tab 1        │                                  │
│  │  (example.com)       │                                  │
│  │                      │                                  │
│  │  Context:            │                                  │
│  │  - browserTabId: 1   │                                  │
│  │  - splitPaneId: null │  ◀── Normal tab context          │
│  │  - isSplitView: false│                                  │
│  └──────────────────────┘                                  │
│           │                                                 │
│           │ Broadcast with context:                        │
│           │ { browserTabId: 1, splitPaneId: null }         │
│           ▼                                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Split View Tab 1                                    │  │
│  │                                                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │  │
│  │  │ Pane 1-1 │  │ Pane 1-2 │  │ Pane 1-3 │          │  │
│  │  │          │  │          │  │          │          │  │
│  │  │ Context: │  │ Context: │  │ Context: │          │  │
│  │  │ tabId: 2 │  │ tabId: 2 │  │ tabId: 2 │          │  │
│  │  │ paneId: 1│  │ paneId: 2│  │ paneId: 3│          │  │
│  │  │ split:✓  │  │ split:✓  │  │ split:✓  │          │  │
│  │  └──────────┘  └──────────┘  └──────────┘          │  │
│  │      │              │              │                │  │
│  │      │              │              │                │  │
│  │      │ Filters broadcasts based on:               │  │
│  │      │ 1. browserTabId match                      │  │
│  │      │ 2. splitPaneId match                       │  │
│  │      │ 3. Source context (normal vs split)        │  │
│  │      ▼              ▼              ▼                │  │
│  │   ✓ Allow       ✗ Filter      ✗ Filter            │  │
│  │   (Same pane)   (Diff pane)   (Diff pane)         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                             │
│  New Components:                                           │
│  - SplitViewDetector: Detects split panes via DOM          │
│  - FocusTracker: Tracks which pane has user focus          │
│  - ContextFilter: Filters broadcasts by context            │
│  - QuickTabManagerPositionSync: Syncs panel position       │
└─────────────────────────────────────────────────────────────┘
```

---

## Requirement Analysis

### R1: Normal Tab Quick Tabs Don't Appear in Split View

**User Story**: "When I open a Quick Tab in Tab 1, that Quick Tab should also
show up in Tab 2 and Tab 3, but when I switch to Split View Tab 1 with two or
more webpages in that split view, the Quick Tab opened in Tab 1 shouldn't be
there in any of the pages in Split View Tab 1."

**Technical Breakdown**:

```javascript
// Scenario: User opens Quick Tab in Normal Tab 1
// Expected behavior:

Tab 1 (Normal, example.com)
  ├─ User presses 'Q'
  ├─ Creates Quick Tab
  └─ Broadcasts: {
      browserTabId: 1,
      splitPaneId: null,  // ◀── NULL = normal tab
      isSplitView: false,
      url: "https://github.com"
    }

Tab 2 (Normal, example.com)
  ├─ Receives broadcast
  ├─ Checks: isSplitView === false? ✓
  ├─ Checks: same browserTabId? ✗ (Tab 2 ≠ Tab 1)
  └─ ✅ CREATES Quick Tab (cross-tab sync)

Split View Tab 1 (example.com in all panes)
  ├─ Split Pane 1-1
  │   ├─ Receives broadcast
  │   ├─ Checks: isSplitView === false (source)? ✓
  │   ├─ Checks: isSplitView === true (receiver)? ✓
  │   └─ ✗ FILTERS OUT (normal tab → split view = block)
  ├─ Split Pane 1-2
  │   └─ ✗ FILTERS OUT (same logic)
  └─ Split Pane 1-3
      └─ ✗ FILTERS OUT (same logic)
```

**Implementation Requirements**:

1. Add `isSplitView` boolean flag to broadcast messages
2. Add `splitPaneId` to broadcast messages (null for normal tabs)
3. Modify `handleBroadcastMessage()` to filter out normal tab → split view
   broadcasts
4. Preserve cross-tab sync for normal tabs (Tab 1 → Tab 2/3)

**Key Insight**: The filter is **unidirectional**. Normal tab Quick Tabs don't
sync to split views, but split view Quick Tabs can still be isolated (R2).

---

### R2: Split View Quick Tabs Isolated to Single Pane

**User Story**: "Whenever I open Quick Tab 1 in Split View Tab 1-1, the Quick
Tab should only show up in Split View Tab 1-1, and not in Split View Tab 1-2
through 4. Moreover, Quick Tab 1 opened in Split View Tab 1-1 shouldn't show up
in any other tab or any other Split View Tab."

**Technical Breakdown**:

```javascript
// Scenario: User opens Quick Tab in Split View Tab 1-1

Split View Tab 1-1 (youtube.com)
  ├─ User presses 'Q'
  ├─ Creates Quick Tab
  └─ Broadcasts: {
      browserTabId: 2,     // Split View Tab 1's tab ID
      splitPaneId: "pane_1", // ◀── Unique pane identifier
      isSplitView: true,
      url: "https://github.com"
    }

Split View Tab 1-2 (reddit.com)
  ├─ Receives broadcast
  ├─ Checks: isSplitView === true (source)? ✓
  ├─ Checks: browserTabId match? ✓ (both in Split View Tab 1)
  ├─ Checks: splitPaneId match? ✗ ("pane_1" ≠ "pane_2")
  └─ ✗ FILTERS OUT (different pane in same split view)

Split View Tab 1-3 (github.com)
  └─ ✗ FILTERS OUT (different pane)

Split View Tab 1-4 (stackoverflow.com)
  └─ ✗ FILTERS OUT (different pane)

Normal Tab 1 (example.com)
  ├─ Receives broadcast
  ├─ Checks: isSplitView === true (source)? ✓
  ├─ Checks: browserTabId match? ✗ (Tab 1 ≠ Split View Tab 1)
  └─ ✗ FILTERS OUT (split view → normal tab = block)

Split View Tab 2-1 (Different split view tab)
  ├─ Receives broadcast
  ├─ Checks: browserTabId match? ✗ (Split Tab 2 ≠ Split Tab 1)
  └─ ✗ FILTERS OUT (different split view tab)
```

**Implementation Requirements**:

1. Generate unique `splitPaneId` for each split pane
2. Add `splitPaneId` matching logic to `handleBroadcastMessage()`
3. Block split view → normal tab sync
4. Block split view → different split view sync

**Key Insight**: Split panes are **completely isolated**. No Quick Tab sync
occurs between split panes, even within the same split view tab.

---

### R3: Quick Tab Manager Focus-Following in Split View

**User Story**: "Whenever I open the Quick Tab Manager in Split View Tab 1-1,
the Quick Tab Manager should only open in Split View Tab 1-1 and not in 1-2
through 4. Moreover, when I click off of Split View Tab 1-1 and into 1-2 through
4 while the Quick Tab manager is still open, the Quick Tab manager should have
its visibility toggled off in Split View Tab 1-1 and be toggled on in whatever
Split View Tab window I switched my focus to; that also means that in a Split
View Tab, the Quick Tab manager should only ever be in one window in that Split
View Tab at once."

**Technical Breakdown**:

```javascript
// Scenario: User opens Quick Tab Manager in Split View Tab 1-1

Initial State: Split View Tab 1-1 focused
  ├─ User presses 'Ctrl+Alt+Z' (Quick Tab Manager toggle)
  ├─ Quick Tab Manager opens in Split Pane 1-1
  └─ Visibility: { pane_1: true, pane_2: false, pane_3: false, pane_4: false }

User clicks on Split Pane 1-2 (Focus change event)
  ├─ Detects focus change: pane_1 → pane_2
  ├─ Hides Quick Tab Manager in pane_1
  ├─ Shows Quick Tab Manager in pane_2 (at same relative position)
  └─ Visibility: { pane_1: false, pane_2: true, pane_3: false, pane_4: false }

User clicks on Split Pane 1-3 (Focus change event)
  ├─ Detects focus change: pane_2 → pane_3
  ├─ Hides Quick Tab Manager in pane_2
  ├─ Shows Quick Tab Manager in pane_3 (at same relative position)
  └─ Visibility: { pane_1: false, pane_2: false, pane_3: true, pane_4: false }

User closes Quick Tab Manager in pane_3
  └─ Visibility: { pane_1: false, pane_2: false, pane_3: false, pane_4: false }
```

**Implementation Requirements**:

1. Detect focus changes between split panes (mousedown, click, Tab navigation)
2. Store Quick Tab Manager visibility state per split pane
3. Toggle visibility on focus change (hide in old pane, show in new pane)
4. Preserve panel position during focus transitions

**Key Challenges**:

- **Focus Detection**: How to detect which split pane has focus?
  - Solution: Listen to `mousedown`, `click`, `focus` events on `document`
  - Use `document.hasFocus()` to verify focus state
  - Track `lastFocusedPaneId` globally
- **Cross-Pane Communication**: How to hide panel in old pane when focus moves?
  - Solution: Use BroadcastChannel to send "hide panel" messages
  - Each pane listens for "FOCUS_CHANGED" broadcasts
  - If broadcast.newFocusedPaneId !== currentPaneId, hide panel

**Key Insight**: The Quick Tab Manager behaves like a **spotlight** - only
visible in the currently focused split pane.

---

### R4: Quick Tab Manager Position Persistence

**User Story**: "Whenever I have the Quick Tab Manager open in either Split View
Tab 1-1 through 4, and then I switch over to Tab 1, the Quick Tab Manager should
be in the relative same position in Tab 1 as it was in Split View Tab 1-1
through 4; if I had the Quick Tab Manager in the top right corner in Split View
Tab 1-1, then switched over to Tab 1, the Quick Tab Manager should be in the top
right corner in Tab 1."

**Technical Breakdown**:

```javascript
// Scenario: Quick Tab Manager in Split View Tab 1-2, then switch to Normal Tab 1

Split View Tab 1-2 (reddit.com)
  ├─ Quick Tab Manager open at: { left: 1520px, top: 100px }
  ├─ Viewport size: { width: 1920px, height: 1080px }
  ├─ Calculate relative position:
  │   relativeLeft = 1520 / 1920 = 0.792 (79.2% from left)
  │   relativeTop = 100 / 1080 = 0.093 (9.3% from top)
  └─ Save: { relativeLeft: 0.792, relativeTop: 0.093 }

User switches to Normal Tab 1 (example.com)
  ├─ Detects tab change (browser.tabs.onActivated)
  ├─ Loads saved relative position: { relativeLeft: 0.792, relativeTop: 0.093 }
  ├─ Normal Tab 1 viewport: { width: 1920px, height: 1080px }
  ├─ Calculate absolute position:
  │   absoluteLeft = 0.792 × 1920 = 1520px
  │   absoluteTop = 0.093 × 1080 = 100px
  └─ ✅ Quick Tab Manager appears at: { left: 1520px, top: 100px }

Alternative Scenario: Different viewport size
  ├─ Normal Tab 1 viewport: { width: 1366px, height: 768px }
  ├─ Calculate absolute position:
  │   absoluteLeft = 0.792 × 1366 = 1082px
  │   absoluteTop = 0.093 × 768 = 71px
  └─ ✅ Panel maintains "top right corner" position
```

**Implementation Requirements**:

1. Store Quick Tab Manager position as **relative percentages** (not absolute
   pixels)
2. Calculate relative position whenever panel is moved/resized
3. Convert relative position to absolute pixels when showing panel
4. Handle viewport size changes (window resize, split view layout changes)

**Position Storage Format**:

```javascript
panelState = {
  relativeLeft: 0.792, // 79.2% from left edge
  relativeTop: 0.093, // 9.3% from top edge
  relativeWidth: 0.182, // 18.2% of viewport width
  relativeHeight: 0.463, // 46.3% of viewport height
  isOpen: true,
  lastUpdated: 1731618000000
};
```

**Key Insight**: Relative positioning ensures the panel maintains its **visual
location** (e.g., "top right corner") across different viewport sizes and tab
contexts.

---

## Implementation Strategy

### Phase 1: Split View Detection (Foundation)

**Goal**: Reliably detect whether the current browsing context is a normal tab
or a split pane, and identify unique split panes.

#### 1.1 Split View Detection Module

```javascript
// New file: split-view-detector.js
// Detects Zen Browser's split view DOM structure

class SplitViewDetector {
  constructor() {
    this.isSplitView = false;
    this.splitPaneId = null;
    this.browserTabId = null;
    this.lastCheck = 0;
    this.checkInterval = 500; // Check every 500ms
  }

  /**
   * Check if current context is in Zen Browser split view
   * @returns {boolean} True if in split view
   */
  isInSplitView() {
    // Zen Browser split panes have this DOM structure:
    // .browserSidebarContainer[is-zen-split="true"]
    const browserContainer = this._findBrowserContainer();

    if (!browserContainer) {
      this.isSplitView = false;
      return false;
    }

    // Check for split view attribute
    const isSplit = browserContainer.getAttribute('is-zen-split') === 'true';
    this.isSplitView = isSplit;

    return isSplit;
  }

  /**
   * Get unique identifier for current split pane
   * @returns {string|null} Pane ID or null if not in split view
   */
  getSplitPaneId() {
    if (!this.isInSplitView()) {
      this.splitPaneId = null;
      return null;
    }

    const browserContainer = this._findBrowserContainer();
    if (!browserContainer) return null;

    // Generate pane ID based on DOM position
    // Find all split panes in current tab
    const allPanes = document.querySelectorAll(
      '.browserSidebarContainer[is-zen-split="true"]'
    );
    const paneIndex = Array.from(allPanes).indexOf(browserContainer);

    if (paneIndex === -1) return null;

    // Generate unique ID: tab_{browserTabId}_pane_{index}
    this.splitPaneId = `tab_${this.browserTabId}_pane_${paneIndex}`;

    return this.splitPaneId;
  }

  /**
   * Find the browser container element
   * @private
   * @returns {Element|null}
   */
  _findBrowserContainer() {
    // Try multiple strategies to find the container

    // Strategy 1: Check if document is inside a browser container
    let container = document.querySelector(
      '.browserSidebarContainer[is-zen-split="true"]'
    );
    if (container && this._isInsideContainer(container)) {
      return container;
    }

    // Strategy 2: Traverse up from document.documentElement
    let current = document.documentElement;
    while (current) {
      if (current.classList?.contains('browserSidebarContainer')) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  /**
   * Check if current document is inside given container
   * @private
   */
  _isInsideContainer(container) {
    const browser = container.querySelector('browser');
    if (!browser) return false;

    try {
      return browser.contentDocument === document;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get browser tab ID
   * @returns {Promise<number|null>}
   */
  async getBrowserTabId() {
    if (this.browserTabId !== null) {
      return this.browserTabId;
    }

    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true
      });
      if (tabs.length > 0) {
        this.browserTabId = tabs[0].id;
        return this.browserTabId;
      }
    } catch (err) {
      console.error('[SplitViewDetector] Error getting browser tab ID:', err);
    }

    return null;
  }

  /**
   * Get complete context information
   * @returns {Promise<Object>} Context object
   */
  async getContext() {
    const browserTabId = await this.getBrowserTabId();
    const isSplitView = this.isInSplitView();
    const splitPaneId = this.getSplitPaneId();

    return {
      browserTabId: browserTabId,
      isSplitView: isSplitView,
      splitPaneId: splitPaneId,
      timestamp: Date.now()
    };
  }
}

// Global instance
const splitViewDetector = new SplitViewDetector();
```

**Integration**: Add to `content-legacy.js`:

```javascript
// At top of file, after CONFIG initialization
const splitViewDetector = new SplitViewDetector();

// Initialize on page load
splitViewDetector.getBrowserTabId().then(tabId => {
  debug(
    `[SPLIT VIEW] Content script running in tab ${tabId}, split view: ${splitViewDetector.isInSplitView()}`
  );
});
```

#### 1.2 Context-Aware Broadcasts

**Modify**: `broadcastQuickTabCreation()` in `content-legacy.js`

```javascript
// BEFORE (v1.5.8.16):
async function broadcastQuickTabCreation(
  url,
  width,
  height,
  left,
  top,
  pinnedToUrl = null,
  quickTabId = null
) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'createQuickTab',
    id: quickTabId,
    url: url,
    width: width,
    height: height,
    left: left,
    top: top,
    pinnedToUrl: pinnedToUrl,
    senderId: tabInstanceId,
    cookieStoreId: await getCurrentCookieStoreId(),
    timestamp: Date.now()
  });
}

// AFTER (v1.5.9+):
async function broadcastQuickTabCreation(
  url,
  width,
  height,
  left,
  top,
  pinnedToUrl = null,
  quickTabId = null
) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  // Get context information
  const context = await splitViewDetector.getContext();

  quickTabChannel.postMessage({
    action: 'createQuickTab',
    id: quickTabId,
    url: url,
    width: width,
    height: height,
    left: left,
    top: top,
    pinnedToUrl: pinnedToUrl,
    senderId: tabInstanceId,
    cookieStoreId: await getCurrentCookieStoreId(),
    timestamp: Date.now(),

    // NEW: Add context information
    sourceContext: {
      browserTabId: context.browserTabId,
      isSplitView: context.isSplitView,
      splitPaneId: context.splitPaneId
    }
  });

  debug(
    `[BROADCAST] Sent Quick Tab creation with context: tab=${context.browserTabId}, split=${context.isSplitView}, pane=${context.splitPaneId}`
  );
}
```

#### 1.3 Context-Aware Broadcast Filtering

**Modify**: `handleBroadcastMessage()` in `content-legacy.js`

```javascript
// BEFORE (v1.5.8.16):
async function handleBroadcastMessage(event) {
  const message = event.data;

  // Ignore broadcasts from ourselves
  if (message.senderId === tabInstanceId) {
    debug(`Ignoring broadcast from self (Instance ID: ${tabInstanceId})`);
    return;
  }

  // ... rest of broadcast handling ...
}

// AFTER (v1.5.9+):
async function handleBroadcastMessage(event) {
  const message = event.data;

  // Ignore broadcasts from ourselves
  if (message.senderId === tabInstanceId) {
    debug(`Ignoring broadcast from self (Instance ID: ${tabInstanceId})`);
    return;
  }

  // NEW: Get receiver context
  const receiverContext = await splitViewDetector.getContext();
  const sourceContext = message.sourceContext || {};

  // NEW: Apply context filtering rules
  if (!shouldAcceptBroadcast(sourceContext, receiverContext)) {
    debug(
      `[FILTER] Blocked broadcast: source={tab:${sourceContext.browserTabId}, split:${sourceContext.isSplitView}, pane:${sourceContext.splitPaneId}}, receiver={tab:${receiverContext.browserTabId}, split:${receiverContext.isSplitView}, pane:${receiverContext.splitPaneId}}`
    );
    return;
  }

  debug(
    `[FILTER] Accepted broadcast: source={tab:${sourceContext.browserTabId}, split:${sourceContext.isSplitView}}, receiver={tab:${receiverContext.browserTabId}, split:${receiverContext.isSplitView}}`
  );

  // ... rest of broadcast handling (unchanged) ...
}

/**
 * Determine if a broadcast should be accepted based on source and receiver context
 * @param {Object} source - Source context { browserTabId, isSplitView, splitPaneId }
 * @param {Object} receiver - Receiver context { browserTabId, isSplitView, splitPaneId }
 * @returns {boolean} True if broadcast should be accepted
 */
function shouldAcceptBroadcast(source, receiver) {
  // Rule 1: Normal tab → Normal tab (different tabs) = ACCEPT
  // This maintains cross-tab sync for normal tabs
  if (!source.isSplitView && !receiver.isSplitView) {
    // Different browser tabs = sync
    if (source.browserTabId !== receiver.browserTabId) {
      return true;
    }
    // Same browser tab = filter (already have the Quick Tab)
    return false;
  }

  // Rule 2: Normal tab → Split view = REJECT (R1)
  // Quick Tabs from normal tabs don't appear in split views
  if (!source.isSplitView && receiver.isSplitView) {
    return false;
  }

  // Rule 3: Split view → Normal tab = REJECT (R2)
  // Quick Tabs from split views don't appear in normal tabs
  if (source.isSplitView && !receiver.isSplitView) {
    return false;
  }

  // Rule 4: Split view → Split view (same split pane) = ACCEPT
  // Allow broadcasts within the exact same split pane
  if (source.isSplitView && receiver.isSplitView) {
    // Must match: same browser tab AND same split pane ID
    if (
      source.browserTabId === receiver.browserTabId &&
      source.splitPaneId === receiver.splitPaneId
    ) {
      return true;
    }
    // Different pane or different split view tab = reject
    return false;
  }

  // Fallback: reject unknown cases
  return false;
}
```

**Filtering Logic Truth Table**:

| Source Context     | Receiver Context   | Accept? | Rule | Reason                                               |
| ------------------ | ------------------ | ------- | ---- | ---------------------------------------------------- |
| Normal Tab 1       | Normal Tab 2       | ✅ Yes  | R1   | Cross-tab sync                                       |
| Normal Tab 1       | Normal Tab 1       | ❌ No   | -    | Same tab (already exists)                            |
| Normal Tab 1       | Split View Tab 1-1 | ❌ No   | R1   | Block normal → split                                 |
| Split View Tab 1-1 | Normal Tab 1       | ❌ No   | R2   | Block split → normal                                 |
| Split View Tab 1-1 | Split View Tab 1-1 | ✅ Yes  | R2   | Same pane (already exists, but allow for edge cases) |
| Split View Tab 1-1 | Split View Tab 1-2 | ❌ No   | R2   | Different pane in same split tab                     |
| Split View Tab 1-1 | Split View Tab 2-1 | ❌ No   | R2   | Different split view tab                             |

---

### Phase 2: Quick Tab Manager Focus Tracking (R3)

**Goal**: Make the Quick Tab Manager panel visible only in the currently focused
split pane, and automatically switch visibility when focus changes.

#### 2.1 Focus Tracking Module

```javascript
// New file: focus-tracker.js
// Tracks which split pane has user focus

class FocusTracker {
  constructor() {
    this.currentFocusedPaneId = null;
    this.lastFocusTime = 0;
    this.focusListeners = [];
    this.initialized = false;
  }

  /**
   * Initialize focus tracking
   */
  async initialize() {
    if (this.initialized) return;

    const context = await splitViewDetector.getContext();
    this.currentFocusedPaneId =
      context.splitPaneId || `tab_${context.browserTabId}`;

    // Listen for focus events
    document.addEventListener('mousedown', e => this.handleFocusEvent(e), true);
    document.addEventListener('focusin', e => this.handleFocusEvent(e), true);

    // Listen for BroadcastChannel focus changes
    if (quickTabChannel) {
      quickTabChannel.addEventListener('message', event => {
        if (event.data.action === 'FOCUS_CHANGED') {
          this.handleRemoteFocusChange(event.data);
        }
      });
    }

    this.initialized = true;
    debug(
      `[FOCUS TRACKER] Initialized with focus on pane: ${this.currentFocusedPaneId}`
    );
  }

  /**
   * Handle focus events (mousedown, focusin)
   */
  async handleFocusEvent(event) {
    const context = await splitViewDetector.getContext();
    const newFocusedPaneId =
      context.splitPaneId || `tab_${context.browserTabId}`;

    // Check if focus changed
    if (newFocusedPaneId !== this.currentFocusedPaneId) {
      const oldFocusedPaneId = this.currentFocusedPaneId;
      this.currentFocusedPaneId = newFocusedPaneId;
      this.lastFocusTime = Date.now();

      debug(
        `[FOCUS TRACKER] Focus changed: ${oldFocusedPaneId} → ${newFocusedPaneId}`
      );

      // Broadcast focus change
      this.broadcastFocusChange(oldFocusedPaneId, newFocusedPaneId);

      // Notify listeners
      this.notifyFocusChange(oldFocusedPaneId, newFocusedPaneId);
    }
  }

  /**
   * Handle remote focus change (from BroadcastChannel)
   */
  handleRemoteFocusChange(data) {
    const { oldFocusedPaneId, newFocusedPaneId, senderId } = data;

    // Ignore messages from ourselves
    if (senderId === tabInstanceId) return;

    // Check if this affects us (we lost focus)
    const context = splitViewDetector.getContext();
    const ourPaneId = context.splitPaneId || `tab_${context.browserTabId}`;

    if (oldFocusedPaneId === ourPaneId) {
      debug(`[FOCUS TRACKER] We lost focus to ${newFocusedPaneId}`);
      this.notifyFocusChange(ourPaneId, newFocusedPaneId);
    }
  }

  /**
   * Broadcast focus change to other panes
   */
  async broadcastFocusChange(oldPaneId, newPaneId) {
    if (!quickTabChannel) return;

    const context = await splitViewDetector.getContext();

    quickTabChannel.postMessage({
      action: 'FOCUS_CHANGED',
      oldFocusedPaneId: oldPaneId,
      newFocusedPaneId: newPaneId,
      browserTabId: context.browserTabId,
      isSplitView: context.isSplitView,
      senderId: tabInstanceId,
      timestamp: Date.now()
    });
  }

  /**
   * Register focus change listener
   * @param {Function} callback - Called with (oldPaneId, newPaneId)
   */
  onFocusChange(callback) {
    this.focusListeners.push(callback);
  }

  /**
   * Notify all focus change listeners
   */
  notifyFocusChange(oldPaneId, newPaneId) {
    this.focusListeners.forEach(callback => {
      try {
        callback(oldPaneId, newPaneId);
      } catch (err) {
        console.error('[FOCUS TRACKER] Error in focus change listener:', err);
      }
    });
  }

  /**
   * Get currently focused pane ID
   * @returns {string|null}
   */
  getCurrentFocusedPaneId() {
    return this.currentFocusedPaneId;
  }

  /**
   * Check if current pane has focus
   * @returns {boolean}
   */
  async hasFocus() {
    const context = await splitViewDetector.getContext();
    const ourPaneId = context.splitPaneId || `tab_${context.browserTabId}`;
    return this.currentFocusedPaneId === ourPaneId;
  }
}

// Global instance
const focusTracker = new FocusTracker();
```

#### 2.2 Quick Tab Manager Focus-Aware Visibility

**Modify**: `toggleQuickTabsPanel()` in `content-legacy.js`

```javascript
// BEFORE (v1.5.8.16):
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
}

// AFTER (v1.5.9+):
async function toggleQuickTabsPanel() {
  if (!quickTabsPanel) {
    createQuickTabsPanel();
  }

  const context = await splitViewDetector.getContext();
  const currentPaneId = context.splitPaneId || `tab_${context.browserTabId}`;

  // Determine if we should show or hide
  const shouldShow = !isPanelOpen;

  if (shouldShow) {
    // Show panel in current pane
    showQuickTabsPanelInPane(currentPaneId);

    // If in split view, broadcast "panel opened" to hide in other panes
    if (context.isSplitView) {
      broadcastPanelVisibilityChange(currentPaneId, true);
    }
  } else {
    // Hide panel
    hideQuickTabsPanelInPane(currentPaneId);

    // If in split view, broadcast "panel closed"
    if (context.isSplitView) {
      broadcastPanelVisibilityChange(currentPaneId, false);
    }
  }
}

/**
 * Show Quick Tab Manager panel in specific pane
 * @param {string} paneId - Pane ID to show panel in
 */
function showQuickTabsPanelInPane(paneId) {
  quickTabsPanel.style.display = 'flex';
  quickTabsPanel.style.zIndex = '999999999';
  isPanelOpen = true;
  panelState.isOpen = true;
  panelState.visibleInPaneId = paneId;

  // Update content
  updatePanelContent();

  // Save state
  savePanelState();

  debug(`[PANEL] Shown in pane ${paneId}`);
}

/**
 * Hide Quick Tab Manager panel in specific pane
 * @param {string} paneId - Pane ID to hide panel in
 */
function hideQuickTabsPanelInPane(paneId) {
  quickTabsPanel.style.display = 'none';
  isPanelOpen = false;
  panelState.isOpen = false;
  panelState.visibleInPaneId = null;

  // Save state
  savePanelState();

  debug(`[PANEL] Hidden in pane ${paneId}`);
}

/**
 * Broadcast panel visibility change
 * @param {string} paneId - Pane ID where panel visibility changed
 * @param {boolean} isVisible - True if panel is now visible
 */
async function broadcastPanelVisibilityChange(paneId, isVisible) {
  if (!quickTabChannel) return;

  const context = await splitViewDetector.getContext();

  quickTabChannel.postMessage({
    action: 'PANEL_VISIBILITY_CHANGED',
    paneId: paneId,
    isVisible: isVisible,
    browserTabId: context.browserTabId,
    senderId: tabInstanceId,
    timestamp: Date.now()
  });

  debug(
    `[PANEL] Broadcast visibility change: pane=${paneId}, visible=${isVisible}`
  );
}

/**
 * Handle panel visibility change broadcast
 * @param {Object} message - Broadcast message
 */
async function handlePanelVisibilityChangeBroadcast(message) {
  // Ignore messages from ourselves
  if (message.senderId === tabInstanceId) return;

  const context = await splitViewDetector.getContext();
  const ourPaneId = context.splitPaneId || `tab_${context.browserTabId}`;

  // Check if we're in the same split view tab
  if (message.browserTabId !== context.browserTabId) return;

  // If panel is visible in another pane, hide it in this pane
  if (message.isVisible && message.paneId !== ourPaneId) {
    if (isPanelOpen) {
      hideQuickTabsPanelInPane(ourPaneId);
      debug(
        `[PANEL] Hidden in pane ${ourPaneId} because panel opened in ${message.paneId}`
      );
    }
  }
}

// Add to handleBroadcastMessage():
async function handleBroadcastMessage(event) {
  const message = event.data;

  // ... existing code ...

  // Handle panel visibility changes
  if (message.action === 'PANEL_VISIBILITY_CHANGED') {
    handlePanelVisibilityChangeBroadcast(message);
    return;
  }

  // ... rest of existing code ...
}
```

#### 2.3 Focus-Based Panel Switching

**Add**: Focus change listener to automatically switch panel visibility

```javascript
// In content-legacy.js, after focusTracker initialization:

focusTracker.onFocusChange(async (oldPaneId, newPaneId) => {
  // Only handle if panel is open
  if (!isPanelOpen) return;

  const context = await splitViewDetector.getContext();

  // Only handle in split view
  if (!context.isSplitView) return;

  const ourPaneId = context.splitPaneId || `tab_${context.browserTabId}`;

  // Check if focus moved to us
  if (newPaneId === ourPaneId) {
    // We gained focus - show panel
    showQuickTabsPanelInPane(ourPaneId);
  }
  // Check if focus moved away from us
  else if (oldPaneId === ourPaneId) {
    // We lost focus - hide panel
    hideQuickTabsPanelInPane(ourPaneId);
  }
});

// Initialize focus tracker on page load
window.addEventListener('load', () => {
  focusTracker.initialize();
});
```

---

### Phase 3: Position Persistence (R4)

**Goal**: Maintain Quick Tab Manager panel position across tab transitions and
split view changes using relative positioning.

#### 3.1 Relative Position Calculator

```javascript
// New utility functions in content-legacy.js

/**
 * Convert absolute panel position to relative (percentage-based)
 * @param {Object} absolutePos - { left, top, width, height } in pixels
 * @param {Object} viewport - { width, height } of viewport
 * @returns {Object} Relative position { relativeLeft, relativeTop, relativeWidth, relativeHeight }
 */
function calculateRelativePosition(absolutePos, viewport) {
  return {
    relativeLeft: absolutePos.left / viewport.width,
    relativeTop: absolutePos.top / viewport.height,
    relativeWidth: absolutePos.width / viewport.width,
    relativeHeight: absolutePos.height / viewport.height
  };
}

/**
 * Convert relative panel position to absolute (pixel-based)
 * @param {Object} relativePos - { relativeLeft, relativeTop, relativeWidth, relativeHeight }
 * @param {Object} viewport - { width, height } of viewport
 * @returns {Object} Absolute position { left, top, width, height } in pixels
 */
function calculateAbsolutePosition(relativePos, viewport) {
  return {
    left: Math.round(relativePos.relativeLeft * viewport.width),
    top: Math.round(relativePos.relativeTop * viewport.height),
    width: Math.round(relativePos.relativeWidth * viewport.width),
    height: Math.round(relativePos.relativeHeight * viewport.height)
  };
}

/**
 * Get current viewport size
 * @returns {Object} { width, height }
 */
function getViewportSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}
```

#### 3.2 Enhanced Panel State Storage

**Modify**: `savePanelState()` in `content-legacy.js`

```javascript
// BEFORE (v1.5.8.16):
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

  browser.storage.local
    .set({ quick_tabs_panel_state: panelState })
    .catch(err => {
      debug('[Panel] Error saving panel state:', err);
    });
}

// AFTER (v1.5.9+):
function savePanelState() {
  if (!quickTabsPanel) return;

  const rect = quickTabsPanel.getBoundingClientRect();
  const viewport = getViewportSize();

  // Calculate both absolute and relative positions
  const absolutePos = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };

  const relativePos = calculateRelativePosition(absolutePos, viewport);

  panelState = {
    // Store absolute position (for same viewport size)
    left: absolutePos.left,
    top: absolutePos.top,
    width: absolutePos.width,
    height: absolutePos.height,

    // Store relative position (for different viewport sizes)
    relativeLeft: relativePos.relativeLeft,
    relativeTop: relativePos.relativeTop,
    relativeWidth: relativePos.relativeWidth,
    relativeHeight: relativePos.relativeHeight,

    // Metadata
    isOpen: isPanelOpen,
    visibleInPaneId: panelState.visibleInPaneId || null,
    lastUpdated: Date.now(),
    viewport: viewport
  };

  browser.storage.local
    .set({ quick_tabs_panel_state: panelState })
    .catch(err => {
      debug('[Panel] Error saving panel state:', err);
    });

  debug(
    `[PANEL] Saved state: abs=(${absolutePos.left}, ${absolutePos.top}), rel=(${(relativePos.relativeLeft * 100).toFixed(1)}%, ${(relativePos.relativeTop * 100).toFixed(1)}%)`
  );
}
```

#### 3.3 Position Restoration with Relative Calculation

**Modify**: Panel creation/restoration logic

```javascript
// BEFORE (v1.5.8.16):
function createQuickTabsPanel() {
  // ... existing panel creation code ...

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

  // ... rest of creation code ...
}

// AFTER (v1.5.9+):
function createQuickTabsPanel() {
  // ... existing panel creation code ...

  // Load saved panel state from storage
  browser.storage.local.get('quick_tabs_panel_state').then(async result => {
    if (result && result.quick_tabs_panel_state) {
      const savedState = result.quick_tabs_panel_state;
      const currentViewport = getViewportSize();

      // Check if viewport size changed
      const viewportChanged =
        !savedState.viewport ||
        savedState.viewport.width !== currentViewport.width ||
        savedState.viewport.height !== currentViewport.height;

      let appliedPos;

      if (viewportChanged && savedState.relativeLeft !== undefined) {
        // Viewport size changed - use relative position
        const relativePos = {
          relativeLeft: savedState.relativeLeft,
          relativeTop: savedState.relativeTop,
          relativeWidth: savedState.relativeWidth,
          relativeHeight: savedState.relativeHeight
        };

        appliedPos = calculateAbsolutePosition(relativePos, currentViewport);

        debug(
          `[PANEL] Viewport changed (${savedState.viewport?.width}x${savedState.viewport?.height} → ${currentViewport.width}x${currentViewport.height}), using relative position`
        );
      } else {
        // Viewport same or no relative position saved - use absolute position
        appliedPos = {
          left: savedState.left,
          top: savedState.top,
          width: savedState.width,
          height: savedState.height
        };

        debug(`[PANEL] Viewport unchanged, using absolute position`);
      }

      // Apply calculated position
      panel.style.left = appliedPos.left + 'px';
      panel.style.top = appliedPos.top + 'px';
      panel.style.width = appliedPos.width + 'px';
      panel.style.height = appliedPos.height + 'px';

      // Ensure panel stays within viewport
      ensurePanelWithinViewport(panel);

      // Update panel state
      panelState = {
        ...savedState,
        left: appliedPos.left,
        top: appliedPos.top,
        width: appliedPos.width,
        height: appliedPos.height,
        viewport: currentViewport
      };

      // Handle visibility based on context
      const context = await splitViewDetector.getContext();
      const currentPaneId =
        context.splitPaneId || `tab_${context.browserTabId}`;

      // Show panel if:
      // 1. It was open before, AND
      // 2. We're in the pane where it was visible (or not in split view)
      if (
        savedState.isOpen &&
        (!context.isSplitView || savedState.visibleInPaneId === currentPaneId)
      ) {
        panel.style.display = 'flex';
        isPanelOpen = true;
        panelState.isOpen = true;
      }
    }
  });

  // ... rest of creation code ...
}

/**
 * Ensure panel stays within viewport bounds
 * @param {HTMLElement} panel - Panel element
 */
function ensurePanelWithinViewport(panel) {
  const rect = panel.getBoundingClientRect();
  const viewport = getViewportSize();

  let left = parseFloat(panel.style.left);
  let top = parseFloat(panel.style.top);
  let width = parseFloat(panel.style.width);
  let height = parseFloat(panel.style.height);

  // Ensure panel doesn't go off-screen
  if (left + width > viewport.width) {
    left = Math.max(0, viewport.width - width);
  }
  if (top + height > viewport.height) {
    top = Math.max(0, viewport.height - height);
  }
  if (left < 0) left = 0;
  if (top < 0) top = 0;

  // Apply corrected position
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
}
```

#### 3.4 Cross-Tab Position Sync

**Add**: Listen for tab activation events to sync panel position

```javascript
// In content-legacy.js, listen for browser tab activation

browser.tabs.onActivated.addListener(async activeInfo => {
  // Load panel state when tab becomes active
  const result = await browser.storage.local.get('quick_tabs_panel_state');

  if (result && result.quick_tabs_panel_state && quickTabsPanel) {
    const savedState = result.quick_tabs_panel_state;
    const currentViewport = getViewportSize();

    // Calculate position (use relative if viewport changed)
    const viewportChanged =
      !savedState.viewport ||
      savedState.viewport.width !== currentViewport.width ||
      savedState.viewport.height !== currentViewport.height;

    let appliedPos;

    if (viewportChanged && savedState.relativeLeft !== undefined) {
      appliedPos = calculateAbsolutePosition(
        {
          relativeLeft: savedState.relativeLeft,
          relativeTop: savedState.relativeTop,
          relativeWidth: savedState.relativeWidth,
          relativeHeight: savedState.relativeHeight
        },
        currentViewport
      );
    } else {
      appliedPos = {
        left: savedState.left,
        top: savedState.top,
        width: savedState.width,
        height: savedState.height
      };
    }

    // Apply position
    quickTabsPanel.style.left = appliedPos.left + 'px';
    quickTabsPanel.style.top = appliedPos.top + 'px';
    quickTabsPanel.style.width = appliedPos.width + 'px';
    quickTabsPanel.style.height = appliedPos.height + 'px';

    ensurePanelWithinViewport(quickTabsPanel);

    debug(
      `[PANEL] Synced position on tab activation: (${appliedPos.left}, ${appliedPos.top})`
    );
  }
});
```

---

## Code Changes Detail

### File: `content-legacy.js`

**Estimated Changes**: ~300 lines added, ~150 lines modified

#### New Global Variables

```javascript
// Split view detection
const splitViewDetector = new SplitViewDetector();
const focusTracker = new FocusTracker();

// Enhanced panel state with relative positioning
let panelState = {
  left: 20,
  top: 100,
  width: 350,
  height: 500,
  relativeLeft: null,
  relativeTop: null,
  relativeWidth: null,
  relativeHeight: null,
  isOpen: false,
  visibleInPaneId: null,
  viewport: null,
  lastUpdated: null
};
```

#### Modified Functions

| Function Name                 | Changes                           | Lines Changed |
| ----------------------------- | --------------------------------- | ------------- |
| `createQuickTabWindow()`      | Add context-aware filtering check | +15           |
| `broadcastQuickTabCreation()` | Add `sourceContext` to message    | +10           |
| `broadcastQuickTabMove()`     | Add `sourceContext` to message    | +10           |
| `broadcastQuickTabResize()`   | Add `sourceContext` to message    | +10           |
| `broadcastQuickTabClose()`    | Add `sourceContext` to message    | +10           |
| `handleBroadcastMessage()`    | Add context filtering logic       | +30           |
| `toggleQuickTabsPanel()`      | Add focus-aware visibility        | +40           |
| `savePanelState()`            | Add relative position calculation | +25           |
| `createQuickTabsPanel()`      | Add relative position restoration | +50           |

#### New Functions

| Function Name                                       | Purpose                      | Lines |
| --------------------------------------------------- | ---------------------------- | ----- |
| `shouldAcceptBroadcast(source, receiver)`           | Filter broadcasts by context | 50    |
| `showQuickTabsPanelInPane(paneId)`                  | Show panel in specific pane  | 20    |
| `hideQuickTabsPanelInPane(paneId)`                  | Hide panel in specific pane  | 15    |
| `broadcastPanelVisibilityChange(paneId, isVisible)` | Broadcast panel visibility   | 20    |
| `handlePanelVisibilityChangeBroadcast(message)`     | Handle visibility broadcasts | 25    |
| `calculateRelativePosition(absolutePos, viewport)`  | Convert to relative position | 10    |
| `calculateAbsolutePosition(relativePos, viewport)`  | Convert to absolute position | 10    |
| `getViewportSize()`                                 | Get viewport dimensions      | 5     |
| `ensurePanelWithinViewport(panel)`                  | Keep panel in viewport       | 20    |

### New File: `split-view-detector.js`

**Lines**: ~200

**Purpose**: Detect Zen Browser split view DOM structure and identify split
panes.

**Key Classes**:

- `SplitViewDetector`: Main class for split view detection

**Key Methods**:

- `isInSplitView()`: Check if in split view
- `getSplitPaneId()`: Get unique pane ID
- `getBrowserTabId()`: Get browser tab ID
- `getContext()`: Get complete context object

### New File: `focus-tracker.js`

**Lines**: ~150

**Purpose**: Track which split pane has user focus.

**Key Classes**:

- `FocusTracker`: Main class for focus tracking

**Key Methods**:

- `initialize()`: Set up focus listeners
- `handleFocusEvent(event)`: Handle focus events
- `broadcastFocusChange(oldPaneId, newPaneId)`: Broadcast focus changes
- `onFocusChange(callback)`: Register focus change listener
- `hasFocus()`: Check if current pane has focus

---

## Testing Plan

### Test Suite 1: Split View Detection

| Test ID | Scenario                    | Expected Result                                     | Validation         |
| ------- | --------------------------- | --------------------------------------------------- | ------------------ |
| SVD-1   | Open normal tab             | `isSplitView = false`, `splitPaneId = null`         | Check console logs |
| SVD-2   | Open split view (2 panes)   | `isSplitView = true`, unique `splitPaneId` per pane | Check console logs |
| SVD-3   | Open split view (4 panes)   | All 4 panes have unique `splitPaneId`               | Check console logs |
| SVD-4   | Switch from normal to split | Context updates correctly                           | Check console logs |
| SVD-5   | Switch from split to normal | Context updates correctly                           | Check console logs |

### Test Suite 2: Quick Tab Filtering (R1)

| Test ID | Scenario                                                         | Expected Result                         | Validation          |
| ------- | ---------------------------------------------------------------- | --------------------------------------- | ------------------- |
| QTF-1   | Open Quick Tab in Tab 1                                          | Quick Tab appears in Tab 2/3            | Visual verification |
| QTF-2   | Open Quick Tab in Tab 1, switch to Split View Tab 1              | Quick Tab NOT in split panes            | Visual verification |
| QTF-3   | Open Quick Tab in Split View Tab 1-1                             | Quick Tab NOT in Tab 1                  | Visual verification |
| QTF-4   | Open Quick Tab in Split View Tab 1-1                             | Quick Tab NOT in Split View Tab 1-2/3/4 | Visual verification |
| QTF-5   | Open Quick Tab in Split View Tab 1-1, switch to Split View Tab 2 | Quick Tab NOT in Split View Tab 2       | Visual verification |

### Test Suite 3: Quick Tab Manager Focus (R3)

| Test ID | Scenario                                     | Expected Result                          | Validation          |
| ------- | -------------------------------------------- | ---------------------------------------- | ------------------- |
| QTM-1   | Open Quick Tab Manager in Split View Tab 1-1 | Panel visible in 1-1 only                | Visual verification |
| QTM-2   | Click on Split View Tab 1-2                  | Panel hides in 1-1, shows in 1-2         | Visual verification |
| QTM-3   | Click on Split View Tab 1-3                  | Panel hides in 1-2, shows in 1-3         | Visual verification |
| QTM-4   | Close panel in Split View Tab 1-3            | Panel closes, no longer visible anywhere | Visual verification |
| QTM-5   | Open panel, switch between all 4 panes       | Panel follows focus correctly            | Visual verification |

### Test Suite 4: Position Persistence (R4)

| Test ID | Scenario                                                         | Expected Result                            | Validation          |
| ------- | ---------------------------------------------------------------- | ------------------------------------------ | ------------------- |
| POS-1   | Move panel to top-right in Split View Tab 1-1, switch to Tab 1   | Panel in top-right of Tab 1                | Measure position %  |
| POS-2   | Move panel to bottom-left in Tab 1, switch to Split View Tab 1-2 | Panel in bottom-left of Split View Tab 1-2 | Measure position %  |
| POS-3   | Resize window, panel maintains relative position                 | Panel stays in same corner                 | Visual verification |
| POS-4   | Move panel, close browser, reopen                                | Panel position restored                    | Measure position    |
| POS-5   | Move panel in 1920x1080 viewport, switch to 1366x768             | Panel maintains relative position          | Measure position %  |

### Integration Testing

| Test ID | Scenario                                                                             | Expected Result                                   |
| ------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| INT-1   | Open Quick Tab in Tab 1, open panel in Tab 1, switch to Split View Tab 1             | Quick Tab not in split, panel position maintained |
| INT-2   | Open Quick Tab in Split View Tab 1-1, move panel around, click to Split View Tab 1-2 | Quick Tab stays in 1-1, panel moves to 1-2        |
| INT-3   | Open 3 Quick Tabs in Split View Tab 1-1/1-2/1-3, open panel                          | Panel shows only Quick Tab for current pane       |
| INT-4   | Minimize Quick Tab in Split View Tab 1-1, switch to Tab 1, restore                   | Quick Tab restores in Split View Tab 1-1 only     |

---

## Backward Compatibility

### Changes with Backward Compatibility Impact

1. **Broadcast Message Format**:
   - **Change**: Added `sourceContext` field to all broadcast messages
   - **Impact**: Old versions (v1.5.8.16 and earlier) will ignore the new field,
     but will still function
   - **Mitigation**: Make `sourceContext` optional in
     `handleBroadcastMessage()`:

   ```javascript
   const sourceContext = message.sourceContext || {
     browserTabId: null,
     isSplitView: false,
     splitPaneId: null
   };
   ```

2. **Panel State Storage Format**:
   - **Change**: Added relative position fields to panel state
   - **Impact**: Old panel states won't have relative fields
   - **Mitigation**: Check for existence before using:

   ```javascript
   if (savedState.relativeLeft !== undefined) {
     // Use relative position
   } else {
     // Fallback to absolute position
   }
   ```

3. **Storage Migration**:
   - **Required**: Migrate old panel state format to new format
   - **Implementation**:

   ```javascript
   async function migratePanelState() {
     const result = await browser.storage.local.get('quick_tabs_panel_state');

     if (result && result.quick_tabs_panel_state) {
       const state = result.quick_tabs_panel_state;

       // Check if migration needed
       if (state.relativeLeft === undefined) {
         const viewport = getViewportSize();
         const relativePos = calculateRelativePosition(
           {
             left: state.left,
             top: state.top,
             width: state.width,
             height: state.height
           },
           viewport
         );

         state.relativeLeft = relativePos.relativeLeft;
         state.relativeTop = relativePos.relativeTop;
         state.relativeWidth = relativePos.relativeWidth;
         state.relativeHeight = relativePos.relativeHeight;
         state.viewport = viewport;
         state.lastUpdated = Date.now();

         await browser.storage.local.set({ quick_tabs_panel_state: state });
         debug('[MIGRATION] Panel state migrated to v1.5.9 format');
       }
     }
   }

   // Call on extension load
   migratePanelState();
   ```

### Non-Breaking Changes

- Split view detection is **additive** - doesn't affect normal tab behavior
- Focus tracking is **optional** - only activates in split view
- Broadcast filtering is **conservative** - defaults to blocking unknown
  contexts

---

## Performance Considerations

### Potential Performance Impacts

1. **Split View Detection Overhead**:
   - **Issue**: Querying DOM for `.browserSidebarContainer` on every broadcast
   - **Mitigation**: Cache detection results, only re-check every 500ms
   - **Estimated Impact**: <1ms per broadcast

2. **Focus Event Handling**:
   - **Issue**: `mousedown` and `focusin` events fire frequently
   - **Mitigation**: Debounce focus change detection (100ms)
   - **Estimated Impact**: Negligible

3. **BroadcastChannel Message Volume**:
   - **Issue**: Additional broadcasts for panel visibility and focus changes
   - **Mitigation**: Throttle broadcasts (max 1 per 100ms)
   - **Estimated Impact**: <5% increase in message volume

4. **Position Calculation**:
   - **Issue**: Relative ↔ absolute position conversion on every position change
   - **Mitigation**: Calculate only when needed (drag end, tab switch)
   - **Estimated Impact**: <0.5ms per calculation

### Memory Impact

- **New Global Objects**: ~20KB (SplitViewDetector, FocusTracker instances)
- **Broadcast Message Size**: +50 bytes per message (sourceContext field)
- **Panel State Storage**: +100 bytes (relative position fields)

**Total Estimated Memory Increase**: <50KB

### Optimization Strategies

1. **Lazy Initialization**:
   - Only initialize FocusTracker when in split view
   - Only initialize SplitViewDetector on first Quick Tab creation

2. **Event Throttling**:
   - Use `requestAnimationFrame()` for focus event handling
   - Debounce position calculations during drag operations

3. **DOM Query Caching**:
   - Cache `.browserSidebarContainer` query results
   - Invalidate cache on tab change or window resize

---

## Future Enhancements

### Potential Feature Additions

1. **Quick Tab Isolation Preferences**:
   - **Feature**: User-configurable isolation rules
   - **Use Case**: "Always sync Quick Tabs between normal tabs, but isolate in
     split view"
   - **Implementation**: Add config options:

   ```javascript
   CONFIG.quickTabIsolation = 'auto'; // 'auto', 'always', 'never'
   ```

2. **Split Pane Quick Tab Limit**:
   - **Feature**: Different Quick Tab limits per split pane
   - **Use Case**: "Allow 2 Quick Tabs per split pane (8 total in 4-pane split)"
   - **Implementation**: Modify `CONFIG.quickTabMaxWindows` to be context-aware

3. **Quick Tab Manager Multi-View**:
   - **Feature**: Show Quick Tabs from all split panes in one panel
   - **Use Case**: "See all 4 split pane Quick Tabs in a unified manager"
   - **Implementation**: Add "All Panes" view mode to Quick Tab Manager

4. **Position Presets**:
   - **Feature**: Save/load panel position presets
   - **Use Case**: "One-click position for 'coding layout' vs 'browsing layout'"
   - **Implementation**: Add position preset buttons to panel

### Potential API Enhancements

1. **Zen Browser Integration**:
   - **API**: Expose `browser.zenSplitView` API
   - **Methods**: `getSplitPanes()`, `getFocusedPane()`, `onPaneChange()`
   - **Benefit**: Eliminate DOM-based detection, use native API

2. **Firefox WebExtensions**:
   - **API**: Propose `browser.tabs.splitView` API
   - **Methods**: `isSplitView(tabId)`, `getSplitPanes(tabId)`
   - **Benefit**: Standardize split view detection across browsers

---

## Summary

This implementation plan provides a comprehensive roadmap for adding advanced
Split View support to the copy-URL-on-hover extension (v1.5.8.16+). The proposed
changes enable:

1. **R1**: Normal tab Quick Tabs don't sync to Split View Tabs
2. **R2**: Split View Quick Tabs are isolated to individual panes
3. **R3**: Quick Tab Manager follows focus in Split View
4. **R4**: Quick Tab Manager position persists across tab transitions

**Key Technical Achievements**:

- Context-aware broadcast filtering based on tab type and split pane ID
- Focus-tracking system for split pane interaction detection
- Relative position system for viewport-independent panel placement
- Backward-compatible broadcast message format

**Estimated Development Effort**:

- New code: ~550 lines
- Modified code: ~150 lines
- Testing: 25 test cases
- Total estimated time: 20-30 hours

**Risks**:

- Zen Browser DOM structure changes (mitigated by fallback detection)
- Performance impact from additional broadcasts (mitigated by throttling)
- Edge cases in focus detection (mitigated by comprehensive testing)

**Next Steps**:

1. Implement Phase 1 (Split View Detection)
2. Test with Zen Browser's Split View feature
3. Implement Phase 2 (Focus Tracking)
4. Implement Phase 3 (Position Persistence)
5. Integration testing
6. User acceptance testing

This plan ensures all requested behaviors are implemented while maintaining the
existing functionality of the copy-URL-on-hover extension.
