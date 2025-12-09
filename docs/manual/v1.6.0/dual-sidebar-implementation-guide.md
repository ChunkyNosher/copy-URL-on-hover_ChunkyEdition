# Implementation Guide: Separate Settings & Quick Tab Manager Panels

## Executive Summary

**Primary Method (Multiple Separate Sidebars): NOT POSSIBLE**

After comprehensive research of Firefox WebExtensions API documentation, the
**first requested method (two separate sidebar panels with independent keyboard
shortcuts) is not technically possible** due to fundamental Firefox API
limitations.

**Alternative Method (Two-Layer Tab System): FULLY POSSIBLE**

The second requested method (hierarchical tab structure with keyboard shortcut
for Quick Tab Manager) is fully achievable and represents the optimal
implementation path.

---

## Research Findings: Firefox Sidebar API Limitations

### Critical Limitation: Single `sidebar_action` Per Extension

**Official Documentation Source:**

> "An extension defines sidebars using the `sidebar_action` manifest.json key...
> The browser provides a UI that enables the user to see the available sidebars
> and select one to display."
>
> —
> [MDN Web Docs: Sidebars](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars)

**Key Constraint:**

- Firefox only allows **ONE `sidebar_action` declaration per extension** in
  `manifest.json`
- Unlike Chrome's `sidePanel` API which supports multiple panels, Firefox's
  `sidebar_action` is singular
- This is a hard architectural limitation, not a configuration issue

**Supporting Evidence from Research:**

1. **Reddit Discussion (r/firefox):**

   > "Firefox doesn't support multiple sidebars. However, TST does have an API
   > to support a sub-panel from another addon."
   >
   > —
   > [Reddit: Having multiple sidebars?](https://www.reddit.com/r/firefox/comments/v39le4/having_multiple_sidebars/)

2. **Stack Overflow Confirmation:**

   > "While there is no supported API which provides you with more than one
   > sidebar, it is possible to create multiple sidebars (interface panels)
   > [only via unsupported userChrome.js methods]"
   >
   > —
   > [Stack Overflow: Firefox Add-on with multiple sidebars](https://stackoverflow.com/questions/34357582/firefox-sdk-add-on-with-a-sidebar-on-both-the-right-and-left-at-the-same-time)

3. **GitHub Example - Second Sidebar Project:** The `firefox-second-sidebar`
   project by aminought achieves multiple sidebars **only through userChrome.js
   scripting** (modifying Firefox internal browser chrome), which:

- Requires Firefox customization beyond WebExtension APIs
- Is not a WebExtension-based solution
- Cannot be distributed via Mozilla Add-ons store
- Breaks the extension's sandboxing and update compatibility

---

## Why Method 1 (Separate Sidebars) Is Not Possible

### Architectural Constraints

1. **Manifest Limitation:**
   - `manifest.json` only accepts ONE `sidebar_action` object
   - Cannot declare multiple sidebar entries like:

   ```json
   // ❌ THIS DOES NOT WORK
   "sidebar_action_settings": { "default_panel": "sidebar/settings.html" },
   "sidebar_action_manager": { "default_panel": "sidebar/manager.html" }
   ```

2. **API Method Limitation:**
   - `sidebarAction.setPanel()` can **change the content** of the single sidebar
   - But it **cannot create multiple sidebar entries** in Firefox's sidebar menu
   - The sidebar selector UI only shows **one entry per extension**

3. **Keyboard Shortcut Limitation:**
   - `_execute_sidebar_action` command opens/toggles THE sidebar (singular)
   - Cannot bind different shortcuts to different sidebar "instances" because
     only one instance exists
   - Custom commands can trigger `sidebarAction.setPanel()` to switch content,
     but this modifies the same sidebar, not separate panels

### What Doesn't Work

**Attempted Pattern:**

```javascript
// This only switches the content of the SAME sidebar
browser.commands.onCommand.addListener(command => {
  if (command === 'open-settings-sidebar') {
    browser.sidebarAction.setPanel({ panel: 'sidebar/settings.html' });
    browser.sidebarAction.open();
  } else if (command === 'open-manager-sidebar') {
    browser.sidebarAction.setPanel({ panel: 'sidebar/manager.html' });
    browser.sidebarAction.open();
  }
});
```

**Result:** Both shortcuts control the SAME sidebar panel, just switching its
HTML content. There is no "separate sidebar" — only one sidebar with dynamic
content.

---

## Method 2: Two-Layer Tab System (RECOMMENDED IMPLEMENTATION)

### Overview

Implement a hierarchical tab navigation structure within the single sidebar:

**Layer 1 (Primary Tabs):**

- **Settings** — Container for all configuration tabs
- **Quick Tab Manager** — Dedicated panel for manager UI

**Layer 2 (Secondary Tabs - only visible under "Settings"):**

- Copy URL
- Quick Tabs
- Appearance
- Advanced

### Technical Implementation Requirements

#### 1. HTML Structure Modification (`sidebar/settings.html`)

**Current Structure:**

```html
<div class="tabs">
  <button class="tab-button" data-tab="copy-url">Copy URL</button>
  <button class="tab-button" data-tab="quick-tabs">Quick Tabs</button>
  <button class="tab-button" data-tab="appearance">Appearance</button>
  <button class="tab-button" data-tab="advanced">Advanced</button>
  <button class="tab-button" data-tab="manager">Manager</button>
</div>
```

**Needs to become:**

```html
<!-- Primary tabs (Layer 1) -->
<div class="primary-tabs">
  <button class="primary-tab-button active" data-primary-tab="settings">
    Settings
  </button>
  <button class="primary-tab-button" data-primary-tab="manager">
    Quick Tab Manager
  </button>
</div>

<!-- Secondary tabs (Layer 2) - only visible when Settings is active -->
<div class="secondary-tabs" id="settings-subtabs">
  <button class="secondary-tab-button active" data-tab="copy-url">
    Copy URL
  </button>
  <button class="secondary-tab-button" data-tab="quick-tabs">Quick Tabs</button>
  <button class="secondary-tab-button" data-tab="appearance">Appearance</button>
  <button class="secondary-tab-button" data-tab="advanced">Advanced</button>
</div>
```

**Key Changes:**

- Split existing flat tab structure into two-level hierarchy
- Primary tabs control which "mode" the sidebar is in
- Secondary tabs only display when "Settings" primary tab is active
- Manager tab becomes a primary tab, showing full manager UI when selected

#### 2. CSS Styling Updates (`sidebar/settings.css`)

**Requirements:**

- Visually distinguish primary tabs from secondary tabs
- Primary tabs: Larger, more prominent (e.g., 16px font, bolder weight)
- Secondary tabs: Smaller, nested appearance (e.g., 13px font, lighter
  background)
- Add visual indentation or border to show hierarchy
- Ensure `.secondary-tabs` container can be hidden via `display: none` when
  Manager is active
- Consider using different background colors or border styles to create clear
  visual separation

**Recommended Styling Pattern:**

```css
.primary-tabs {
  /* Prominent, full-width tabs at top */
  background: #2a2a2a; /* Darker than secondary */
  border-bottom: 2px solid #4caf50;
  padding: 8px 0;
}

.primary-tab-button {
  font-size: 16px;
  font-weight: 600;
  padding: 14px 20px;
}

.secondary-tabs {
  /* Nested appearance, lighter background */
  background: #252525;
  border-bottom: 1px solid #3a3a3a;
  padding: 4px 0;
  margin-left: 16px; /* Visual indentation */
}

.secondary-tab-button {
  font-size: 13px;
  font-weight: 500;
  padding: 10px 16px;
}
```

#### 3. JavaScript Logic Updates (`sidebar/settings.js`)

**Core Behavioral Requirements:**

**A. Primary Tab Switching:**

- When "Settings" primary tab is clicked:
  - Show `.secondary-tabs` container (`display: flex`)
  - Show all setting tab content containers
  - Hide manager iframe/content
  - Default to "Copy URL" secondary tab if none selected
- When "Quick Tab Manager" primary tab is clicked:
  - Hide `.secondary-tabs` container (`display: none`)
  - Hide all setting tab content containers
  - Show manager iframe/content (full viewport usage)

**B. Secondary Tab Switching:**

- Only functional when "Settings" primary tab is active
- Standard tab switching logic for Copy URL, Quick Tabs, Appearance, Advanced
- Should maintain last-selected secondary tab when switching back to Settings

**C. State Persistence:**

- Store current primary tab selection in browser.storage.local
- Store current secondary tab selection in browser.storage.local
- Restore both on sidebar initialization
- Keys: `sidebarActivePrimaryTab`, `sidebarActiveSecondaryTab`

**Implementation Pattern:**

```javascript
// Primary tab switching handler
function handlePrimaryTabClick(primaryTab) {
  if (primaryTab === 'settings') {
    document.getElementById('settings-subtabs').style.display = 'flex';
    document.getElementById('manager-content').style.display = 'none';
    // Show last active secondary tab or default to copy-url
    const lastSecondaryTab = getStoredSecondaryTab() || 'copy-url';
    showSecondaryTab(lastSecondaryTab);
  } else if (primaryTab === 'manager') {
    document.getElementById('settings-subtabs').style.display = 'none';
    document.getElementById('manager-content').style.display = 'block';
    hideAllSecondaryTabContent();
  }
  storePrimaryTab(primaryTab);
}

// Secondary tab switching handler (only when Settings active)
function handleSecondaryTabClick(secondaryTab) {
  // Standard tab content switching logic
  showSecondaryTab(secondaryTab);
  storeSecondaryTab(secondaryTab);
}
```

#### 4. Manifest.json Command Configuration

**Current Configuration:**

```json
"commands": {
  "toggle-quick-tabs-manager": {
    "suggested_key": { "default": "Alt+Shift+Z" },
    "description": "Toggle Quick Tabs Manager panel"
  },
  "_execute_sidebar_action": {
    "suggested_key": { "default": "Alt+Shift+S" },
    "description": "Toggle settings sidebar"
  }
}
```

**Needs Update To:**

```json
"commands": {
  "open-quick-tabs-manager": {
    "suggested_key": { "default": "Alt+Shift+Z" },
    "description": "Open Quick Tabs Manager in sidebar"
  },
  "_execute_sidebar_action": {
    "suggested_key": { "default": "Alt+Shift+S" },
    "description": "Toggle sidebar (Settings/Manager)"
  }
}
```

**Key Changes:**

- Rename command from `toggle-quick-tabs-manager` to `open-quick-tabs-manager`
  for clarity
- Update description to reflect it opens manager in sidebar, not separate panel
- `_execute_sidebar_action` remains as primary sidebar toggle

#### 5. Background Script Command Handler

**New Background Script Logic Required:**

The `open-quick-tabs-manager` command should:

1. Open the sidebar if closed
2. Switch to "Quick Tab Manager" primary tab via message passing
3. Focus the sidebar window

**Implementation Location:** `src/background/handlers/` (new file or existing
command handler)

**Pattern:**

```javascript
browser.commands.onCommand.addListener(command => {
  if (command === 'open-quick-tabs-manager') {
    // Step 1: Ensure sidebar is open
    browser.sidebarAction.isOpen({}).then(isOpen => {
      if (!isOpen) {
        browser.sidebarAction.open();
      }

      // Step 2: Send message to sidebar to switch to manager tab
      // Small delay to ensure sidebar is fully loaded
      setTimeout(() => {
        browser.runtime.sendMessage({
          type: 'SWITCH_TO_MANAGER_TAB'
        });
      }, 100);
    });
  }
});
```

#### 6. Sidebar Message Listener

**New Message Listener in `sidebar/settings.js`:**

Listen for `SWITCH_TO_MANAGER_TAB` message and activate manager tab:

```javascript
browser.runtime.onMessage.addListener(message => {
  if (message.type === 'SWITCH_TO_MANAGER_TAB') {
    // Programmatically activate Quick Tab Manager primary tab
    const managerTabButton = document.querySelector(
      '[data-primary-tab="manager"]'
    );
    if (managerTabButton) {
      managerTabButton.click(); // Trigger existing click handler
    }
  }
});
```

**Integration Point:** Add this listener in the initialization section of
`sidebar/settings.js`, alongside existing event listeners.

---

## Implementation Checklist

### Phase 1: HTML & CSS Structure

- [ ] Refactor tab HTML structure into two-level hierarchy (primary + secondary)
- [ ] Update CSS to visually distinguish primary tabs from secondary tabs
- [ ] Add show/hide logic CSS classes for secondary tabs container
- [ ] Ensure responsive design maintains clarity at different sidebar widths

### Phase 2: JavaScript Tab Logic

- [ ] Implement primary tab click handler with show/hide logic
- [ ] Implement secondary tab click handler (existing logic repurposed)
- [ ] Add state persistence for both primary and secondary tab selections
- [ ] Implement state restoration on sidebar initialization
- [ ] Add transition animations between tab switches (optional polish)

### Phase 3: Keyboard Shortcut Integration

- [ ] Update manifest.json commands section
- [ ] Create background script command handler for `open-quick-tabs-manager`
- [ ] Implement sidebar message listener for tab switching
- [ ] Test keyboard shortcut triggers correct tab activation
- [ ] Verify sidebar opens if closed when shortcut pressed

### Phase 4: Testing & Validation

- [ ] Test primary tab switching behavior (Settings ↔ Manager)
- [ ] Test secondary tab switching within Settings
- [ ] Test state persistence across sidebar close/reopen
- [ ] Test keyboard shortcut opens sidebar + activates Manager
- [ ] Test keyboard shortcut when sidebar already open
- [ ] Verify no JavaScript errors in browser console
- [ ] Test visual styling across light/dark themes if applicable

---

## Key Architecture Points

### Why This Approach Works

1. **Respects Firefox API Limitations:**
   - Uses single `sidebar_action` as required
   - All content within one sidebar panel
   - No attempt to create "virtual" separate sidebars

2. **Achieves User Intent:**
   - Settings and Manager are logically separated at UI level
   - Keyboard shortcut provides direct access to Manager
   - Clear visual hierarchy prevents confusion

3. **Maintains Existing Functionality:**
   - All current settings tabs remain accessible
   - Manager functionality unchanged
   - Tab switching patterns similar to current implementation

4. **Scalable Design:**
   - Easy to add more primary tabs in future if needed
   - Secondary tab structure can be replicated under other primary tabs
   - Clean separation of concerns between layers

### Potential Enhancements (Optional)

**Breadcrumb Navigation:** Show current location path, e.g., "Settings > Copy
URL"

**Tab History Stack:** Remember navigation history and allow back/forward
navigation

**Tab Bookmarking:** Allow users to bookmark frequently accessed secondary tabs
for quick access

**Context-Aware Shortcuts:** Allow different keyboard shortcuts for different
secondary tabs within Settings

---

## Alternative Workarounds (NOT RECOMMENDED)

### Popup Window Approach

Instead of sidebar, open manager in separate popup window via
`browser.windows.create()`.

**Pros:**

- Truly separate UI instances
- Can have independent keyboard shortcuts

**Cons:**

- Not a sidebar (user requested sidebar-based solution)
- Window management complexity
- Inconsistent with existing sidebar architecture
- Poor UX compared to integrated sidebar

### External Panel via browser.windows.create with type: "panel"

Create a Firefox panel-type window (frameless, always-on-top).

**Pros:**

- Separate from main sidebar
- Lightweight window

**Cons:**

- Not integrated with Firefox sidebar UI
- Panel windows have limited support and may behave inconsistently
- Still not a "sidebar" in the traditional Firefox sense

### userChrome.js Modification (AVOID)

Modify Firefox's browser chrome directly to inject second sidebar.

**Pros:**

- Can achieve true separate sidebars

**Cons:**

- Requires users to manually modify Firefox configuration
- Cannot be distributed via Mozilla Add-ons
- Breaks with Firefox updates
- Violates WebExtension sandboxing principles
- Not a portable, maintainable solution

---

## Conclusion

The **two-layer tab system (Method 2)** represents the optimal implementation
path that:

- Is technically feasible within Firefox WebExtensions API constraints
- Achieves the functional goals of separating Settings from Quick Tab Manager
- Maintains keyboard shortcut access to the Manager
- Provides clear visual hierarchy and user experience
- Requires no workarounds or unsupported APIs

The primary method (separate sidebars) is fundamentally incompatible with
Firefox's architectural design and should not be pursued.

---

## References

**Mozilla Developer Network (MDN) Documentation:**

- [Sidebars - WebExtensions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars)
- [sidebarAction API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction)
- [sidebarAction.setPanel()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction/setPanel)
- [commands API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/commands)
- [sidebar_action manifest key](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action)

**Community Discussions & Examples:**

- [Stack Overflow: Firefox WebExtension toolbar buttons to toggle sidebars](https://stackoverflow.com/questions/44741462/firefox-webextension-toolbar-buttons-to-toggle-sidebars)
- [Reddit: Having multiple sidebars?](https://www.reddit.com/r/firefox/comments/v39le4/having_multiple_sidebars/)
- [GitHub: firefox-second-sidebar (userChrome.js approach)](https://github.com/aminought/firefox-second-sidebar)

**API Compatibility Notes:**

- [Chrome incompatibilities - Sidebar API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities#sidebar_api)
  - Notes Chrome uses `sidePanel` API vs Firefox's `sidebarAction`, confirming
    architectural differences

---

## Version History

**Version 1.0** - November 24, 2025

- Initial comprehensive analysis
- Method 1 feasibility determination: NOT POSSIBLE
- Method 2 detailed implementation guide
- Complete technical specifications for two-layer tab system
