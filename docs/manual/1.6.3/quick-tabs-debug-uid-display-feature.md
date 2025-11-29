# Quick Tabs Debug UID Display Feature: Implementation Guide

**Extension Version:** v1.6.x | **Date:** 2025-11-29 | **Scope:** Add toggleable UID display to Quick Tab UI titlebar

---

## Problem Summary

Debugging Quick Tab lifecycle issues (creation, state sync, position persistence, cross-tab visibility) requires verifying which UID is associated with each Quick Tab window. Currently, no UI component displays the UID, forcing developers to check console logs or manually inspect DOM element IDs. This feature adds a toggleable debug display showing the Quick Tab UID directly in the titlebar (top-right corner, left of existing buttons).

---

## Root Cause

No existing mechanism displays Quick Tab UIDs in the UI. The UID is stored in `QuickTabWindow.id` and used throughout the codebase for identification, but never rendered visually. Debug workflows require cross-referencing console logs with Quick Tab windows manually.

**Files Involved:**
- `src/features/quick-tabs/window/TitlebarBuilder.js` (builds titlebar UI)
- `src/features/quick-tabs/window.js` (QuickTabWindow instance holds UID)
- `sidebar/settings.html` (contains Quick Tabs settings toggle controls)
- `sidebar/settings.js` or `options_page.js` (handles settings storage and UI)

<scope>
**Modify:**
- `src/features/quick-tabs/window/TitlebarBuilder.js` (add UID display component)
- `src/features/quick-tabs/window.js` (pass `showDebugId` config to TitlebarBuilder)
- Settings page HTML/JS (add toggle for debug UID display)

**Do NOT Modify:**
- `src/features/quick-tabs/index.js` (QuickTabsManager core logic)
- `background.js` (no background script changes needed)
- Storage schema (uses existing settings storage pattern)
</scope>

---

## Feature Requirements

### User-Facing Behavior

**Settings Toggle:**
- Location: Extension settings page → Quick Tabs tab → "Debug Options" section (create if not exists)
- Label: "Show Quick Tab UIDs (Debug Mode)"
- Default: OFF (unchecked)
- Storage: `browser.storage.local` key: `quickTabShowDebugIds` (boolean)

**Visual Display:**
- Position: Top-right corner of Quick Tab titlebar, immediately LEFT of the first button (Open in Tab button)
- Format: Small monospace text showing truncated UID
- Example: `[qt-123-17…]` (show first ~15 characters with ellipsis if longer)
- Styling: 
  - Font: `monospace, 10px`
  - Color: `#888` (subtle gray, non-intrusive)
  - Padding: `2px 6px`
  - Background: `transparent` or `rgba(0,0,0,0.1)` (optional subtle background)
  - Border: None (or optional `1px solid #555` for clarity)
- Behavior:
  - Always visible when setting enabled, regardless of Quick Tab state
  - Updates if UID changes (unlikely, but graceful handling)
  - Tooltip on hover: Full UID string (e.g., `qt-123-1717281240000-x3j4vq7w82u1`)

**When Disabled:**
- UID display element not rendered at all (no hidden element)
- No performance impact (conditional creation only)

---

## Implementation Approach

### Step 1: Add Settings Storage

**Location:** Settings page (sidebar or options page)

Add toggle control to Quick Tabs settings section:

```html
<!-- Add to Quick Tabs settings section -->
<div class="setting-row">
  <label>
    <input type="checkbox" id="quickTabShowDebugIds">
    Show Quick Tab UIDs (Debug Mode)
  </label>
  <div class="setting-help">
    Display unique identifier in titlebar for debugging. Developer feature.
  </div>
</div>
```

Load/save setting using existing pattern (e.g., `loadSettings()` and `saveSettings()` functions). Follow pattern from other Quick Tab boolean settings like `quickTabCloseOnOpen`.

### Step 2: Pass Setting to QuickTabWindow

**File:** `src/features/quick-tabs/window.js`  
**Location:** `QuickTabWindow` constructor

Add `showDebugId` to initialization options:

```javascript
_initializeBasicProperties(options) {
  this.id = options.id;
  this.url = options.url;
  this.title = options.title || 'Quick Tab';
  this.cookieStoreId = options.cookieStoreId || 'firefox-default';
  this.showDebugId = options.showDebugId ?? false; // NEW: Debug UID display setting
}
```

Pass setting to TitlebarBuilder in `render()` method:

```javascript
this.titlebarBuilder = new TitlebarBuilder(
  {
    id: this.id,
    title: this.title,
    url: this.url,
    soloedOnTabs: this.soloedOnTabs,
    mutedOnTabs: this.mutedOnTabs,
    currentTabId: this.currentTabId,
    iframe: null,
    showDebugId: this.showDebugId // NEW: Pass debug setting
  },
  {
    onClose: () => this.destroy(),
    onMinimize: () => this.minimize(),
    // ... other callbacks
  }
);
```

### Step 3: Add UID Display Component in TitlebarBuilder

**File:** `src/features/quick-tabs/window/TitlebarBuilder.js`  
**Location:** `build()` method

Add conditional UID display element BEFORE button creation:

```javascript
build() {
  const titlebar = createElement('div', {
    className: 'quick-tab-titlebar',
    style: { /* existing titlebar styles */ }
  });

  // Existing drag handle and favicon creation...

  // NEW: Conditionally add debug UID display
  if (this.config.showDebugId) {
    const uidDisplay = this._createUidDisplay();
    titlebar.appendChild(uidDisplay);
  }

  // Existing title element creation...
  
  // Existing buttons creation...
  
  return titlebar;
}
```

Add helper method to create UID display:

```javascript
/**
 * Create debug UID display element
 * Shows truncated UID in titlebar for debugging
 * @private
 * @returns {HTMLElement} UID display element
 */
_createUidDisplay() {
  const fullUid = this.config.id;
  const truncatedUid = fullUid.length > 15 
    ? `${fullUid.substring(0, 15)}…` 
    : fullUid;

  const uidDisplay = createElement('div', {
    className: 'quick-tab-uid-display',
    textContent: `[${truncatedUid}]`,
    title: fullUid, // Full UID on hover tooltip
    style: {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#888',
      padding: '2px 6px',
      marginLeft: 'auto', // Push to right side
      marginRight: '8px', // Space before buttons
      whiteSpace: 'nowrap',
      userSelect: 'all', // Allow selection/copy
      cursor: 'default'
    }
  });

  return uidDisplay;
}
```

**Note on Positioning:** The `marginLeft: 'auto'` CSS property pushes the UID display to the right side of the titlebar. The `marginRight: '8px'` ensures spacing before the button group. Since buttons are typically added after this element, the UID appears LEFT of buttons naturally.

### Step 4: Load Setting When Creating Quick Tab

**File:** `src/features/quick-tabs/handlers/CreateHandler.js`  
**Location:** `_createNewTab()` method

Load debug setting from storage and pass to Quick Tab options:

```javascript
async _createNewTab(id, cookieStoreId, options) {
  this.currentZIndex.value++;

  // Load debug setting from storage
  const settings = await browser.storage.local.get({ quickTabShowDebugIds: false });
  const showDebugId = settings.quickTabShowDebugIds;

  const defaults = this._getDefaults();
  const tabOptions = this._buildTabOptions(id, cookieStoreId, options, defaults);
  
  // Add debug setting to options
  tabOptions.showDebugId = showDebugId;

  const tabWindow = this.createWindow(tabOptions);

  // ... rest of method
}
```

**Why this approach:** Loading setting at creation time ensures each Quick Tab reflects current user preference. If user toggles setting, existing Quick Tabs won't update until they're recreated or page reloads (acceptable for debug feature).

---

<acceptance_criteria>
**Settings UI:**
- [ ] Toggle appears in Quick Tabs settings section
- [ ] Setting persists to `browser.storage.local` as `quickTabShowDebugIds` (boolean)
- [ ] Setting loads correctly on settings page open

**Quick Tab Display:**
- [ ] When enabled, UID display appears in titlebar top-right, LEFT of buttons
- [ ] Display shows truncated UID format: `[qt-123-17…]`
- [ ] Hover tooltip shows full UID string
- [ ] Text is selectable/copyable (for pasting into logs)

**When Disabled:**
- [ ] UID display element not created (no hidden element)
- [ ] No console errors or warnings

**Edge Cases:**
- [ ] Handles very long UIDs gracefully (truncation + tooltip)
- [ ] Works with minimized/restored Quick Tabs
- [ ] Persists across browser restarts

**Manual Test:**
1. Enable "Show Quick Tab UIDs" in settings → Save
2. Create Quick Tab → UID displays in titlebar
3. Hover over UID → Full UID appears in tooltip
4. Disable setting → Reload page → Create new Quick Tab → No UID displayed
</acceptance_criteria>

---

## Styling Recommendations

**Color Scheme Options:**

Light themes:
- Text: `#666` or `#888`
- Background: `transparent` or `rgba(0,0,0,0.05)`

Dark themes (recommended):
- Text: `#888` or `#aaa`
- Background: `transparent` or `rgba(255,255,255,0.05)`

**Truncation Strategy:**

Show first 15 characters plus ellipsis:
- Full: `qt-123-1717281240000-x3j4vq7w82u1`
- Truncated: `qt-123-1717281…`
- Rationale: Includes prefix, tab ID, and partial timestamp (enough for quick visual identification)

**Font Choice:**

Use `monospace` family for technical readability. Fallback: `'Consolas', 'Monaco', 'Courier New', monospace`

---

## Alternative Approaches Considered

### Alternative 1: Display in Window Footer

**Why rejected:** Quick Tabs have no footer. Adding footer increases vertical space usage and complexity. Titlebar is standard location for debug info in windowing systems.

### Alternative 2: Console-Only Toggle

**Why rejected:** Requires opening DevTools and filtering console. Visual display is faster for debugging multi-tab sync issues where developers need to track multiple Quick Tabs simultaneously.

### Alternative 3: Always-On Display (No Toggle)

**Why rejected:** Clutters UI for non-developers. Debug features should be opt-in. Production users don't need to see UIDs.

---

## Testing Workflow

### Manual Verification Steps

1. **Settings Persistence:**
   - Enable setting → Save → Reload extension → Verify still enabled

2. **Visual Display:**
   - Create Quick Tab with setting enabled → Verify UID appears
   - Check positioning (right corner, left of buttons)
   - Verify truncation for long UIDs
   - Hover over UID → Verify full UID tooltip

3. **Toggle Behavior:**
   - Disable setting → Reload page → Create Quick Tab → Verify no UID display
   - Re-enable → Reload → Create Quick Tab → Verify UID reappears

4. **Multi-Tab Scenario:**
   - Open 3 tabs, create Quick Tab in each
   - Verify each shows different UID
   - Cross-reference UIDs with console logs (`[QuickTabsManager] createQuickTab called with: { id: "..." }`)

5. **Copy Functionality:**
   - Select UID text → Copy → Paste into text editor → Verify copied correctly

---

## Supporting Context

<details>
<summary>Current TitlebarBuilder Structure</summary>

`TitlebarBuilder.js` creates titlebar with this general structure:
```
Titlebar (flex container)
├── Drag handle (left)
├── Favicon
├── Title text (flex-grow)
└── Button group (right)
    ├── Open in Tab
    ├── Solo
    ├── Mute
    ├── Minimize
    └── Close
```

The UID display should be inserted BETWEEN title and button group:
```
Titlebar (flex container)
├── Drag handle (left)
├── Favicon
├── Title text (flex-grow)
├── UID Display (NEW, marginLeft: auto) ← Inserted here
└── Button group (right)
```

Using `marginLeft: 'auto'` on UID display pushes it to the right edge, immediately before buttons.
</details>

<details>
<summary>UID Format Details</summary>

UIDs follow format: `qt-{tabId}-{timestamp}-{secureRandom}`

Example: `qt-123-1717281240000-x3j4vq7w82u1`

- `qt`: Prefix (always 3 chars)
- `{tabId}`: Browser tab ID (variable length)
- `{timestamp}`: Unix timestamp in ms (13 digits)
- `{secureRandom}`: Random string (~10-13 chars)

Total length: ~35-45 characters

Truncation at 15 chars captures: `qt-{tabId}-{part}` which is sufficient for visual debugging.
</details>

---

**Priority:** Low (Debug/Developer Feature) | **Dependencies:** None | **Complexity:** Low
