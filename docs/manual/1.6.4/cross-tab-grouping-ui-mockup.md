# Quick Tabs Manager: Cross-Tab Grouping UI Mockup

## Current Layout

```
┌─────────────────────────────────────────────┐
│  Quick Tabs Manager                         │
│  [Close Minimized] [Close All]              │
├─────────────────────────────────────────────┤
│ 5 Quick Tabs  |  Last sync: 14:32:15       │
├─────────────────────────────────────────────┤
│                                             │
│ 📑 All Quick Tabs (5 tabs)                 │
│                                             │
│  🟢 📖 Wikipedia: Shigure Ui (Wikipedia)    │
│      800×600 • Minimized                    │
│      [🔗] [➖] [✕]                          │
│                                             │
│  🟢 📖 Wikipedia: Japan (Wikipedia)         │
│      800×600                                │
│      [🔗] [➖] [✕]                          │
│                                             │
│  🟡 📖 Wikipedia: Tokyo (Wikipedia)         │
│      Minimized • 1024×768 at (200, 100)    │
│      [↑] [✕]                               │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Proposed Layout: Cross-Tab Grouping

### Visual Structure

```
┌─────────────────────────────────────────────┐
│  Quick Tabs Manager                         │
│  [Close Minimized] [Close All]              │
├─────────────────────────────────────────────┤
│ 5 Quick Tabs  |  Last sync: 14:32:15       │
├─────────────────────────────────────────────┤
│                                             │
│ ▼ 🔗 Shigure Ui - Wikipedia (Tab 42)       │
│   [2 Quick Tabs]                           │
│                                             │
│   🟢 📖 Wikipedia: Shigure Ui               │
│       800×600                               │
│       [🔗] [➖] [✕]                         │
│                                             │
│   🟡 📖 Wikipedia: Shigure Ui (Copy)        │
│       Minimized                             │
│       [↑] [✕]                              │
│                                             │
│ ▼ 🔗 Japan - Wikipedia (Tab 14)            │
│   [3 Quick Tabs]                           │
│                                             │
│   🟢 📖 Wikipedia: Japan Overview            │
│       1024×768                              │
│       [🔗] [➖] [✕]                         │
│                                             │
│   🟢 📖 Wikipedia: Japan Geography           │
│       1024×768 at (300, 150)                │
│       [🔗] [➖] [✕]                         │
│                                             │
│   🟡 📖 Wikipedia: Japan History             │
│       Minimized                             │
│       [↑] [✕]                              │
│                                             │
│ ▸ 🔗 Google Search (Tab 8)                 │
│   [1 Quick Tab]                            │
│   (Collapsed)                               │
│                                             │
└─────────────────────────────────────────────┘
```

### Key Changes

1. **Tab Headers (New)**: Thin section headers showing which browser tab owns the Quick Tabs
   - Format: `▼/▸ 🔗 [Page Title] (Tab {id})` or `▼/▸ 🔗 [Page Title] - [Domain] (Tab {id})`
   - Include Quick Tab count: `[2 Quick Tabs]`
   - Clickable to collapse/expand (using `<details>` element)

2. **Tab Grouping**: All Quick Tabs within a browser tab grouped under its header
   - Visual hierarchy makes ownership clear
   - No separate "All Quick Tabs" section

3. **Collapse/Expand Behavior**:
   - Header shows expand/collapse arrow (`▼` = open, `▸` = closed)
   - Clicking header toggles visibility of all Quick Tabs in that tab
   - Collapse state persists in Manager's localStorage (new feature)
   - Useful for long lists with many tabs

4. **Visual Grouping**:
   - Add left border/padding to Quick Tab items (nested appearance)
   - Alternate background colors for different tab groups (optional)
   - Clear visual separation between groups

### HTML Structure (Using `<details>`)

```html
<div class="containers-list">
  <!-- Tab Group 1 -->
  <details class="tab-group" open data-tab-id="42">
    <summary class="tab-group-header">
      <span class="expand-icon">▼</span>
      <span class="favicon-icon">🔗</span>
      <span class="tab-title">Shigure Ui - Wikipedia</span>
      <span class="tab-id">(Tab 42)</span>
      <span class="quick-tab-count">[2 Quick Tabs]</span>
    </summary>
    
    <div class="quick-tabs-list">
      <!-- Quick Tab items here, indented -->
      <div class="quick-tab-item grouped">...</div>
      <div class="quick-tab-item grouped">...</div>
    </div>
  </details>

  <!-- Tab Group 2 -->
  <details class="tab-group" open data-tab-id="14">
    <summary class="tab-group-header">
      <span class="expand-icon">▼</span>
      <span class="favicon-icon">🔗</span>
      <span class="tab-title">Japan - Wikipedia</span>
      <span class="tab-id">(Tab 14)</span>
      <span class="quick-tab-count">[3 Quick Tabs]</span>
    </summary>
    
    <div class="quick-tabs-list">
      <div class="quick-tab-item grouped">...</div>
      <div class="quick-tab-item grouped">...</div>
      <div class="quick-tab-item grouped">...</div>
    </div>
  </details>

  <!-- Tab Group 3 (Collapsed) -->
  <details class="tab-group" data-tab-id="8">
    <summary class="tab-group-header">
      <span class="expand-icon">▸</span>
      <span class="favicon-icon">🔗</span>
      <span class="tab-title">Google Search</span>
      <span class="tab-id">(Tab 8)</span>
      <span class="quick-tab-count">[1 Quick Tab]</span>
    </summary>
    
    <div class="quick-tabs-list">
      <!-- Hidden when collapsed -->
    </div>
  </details>
</div>
```

### CSS Changes Needed

1. **Tab Group Header** (new):
   - Thinner than current Quick Tab items (~8-10px padding vs 10px)
   - Distinct background color (slightly lighter/darker than Quick Tab items)
   - Bold or different font weight for visibility
   - Cursor pointer to indicate clickability
   - Smooth collapse/expand animation

2. **Grouped Quick Tab Items**:
   - Add left border or indentation to show nesting
   - Slightly smaller padding or different background
   - Visual distinction from tab header

3. **Details Element Styling**:
   - Use CSS `::marker` for arrow styling (modern approach)
   - Smooth transitions for open/close animation
   - Override default `<details>` appearance

### JavaScript Changes Needed

1. **Data Grouping**:
   - Group Quick Tabs by `originTabId` (or extracted tab ID from ID pattern)
   - Use `Object.groupBy()` (ES2024) or `reduce()` for grouping
   - Maintain order of browser tabs as they appear in the list
   - Sort within each group (active tabs first, then minimized)

2. **Collapse State Persistence**:
   - Track which tab groups are expanded/collapsed
   - Store in `sessionStorage` or Manager's local state
   - Restore on page load
   - Key: `manager_tab_group_states` with value like `{"42": true, "14": true, "8": false}`

3. **Tab Title Resolution**:
   - For each group, need the browser tab's title/URL
   - Currently available via `browser.tabs.query()` in sidebar context
   - Can extract from Quick Tabs' `originTabId` field
   - Fallback: Use "Unknown Tab" if tab closed

4. **Render Logic Changes**:
   - New function `groupQuickTabsByOriginTabId()` to organize data
   - New function `renderTabGroup()` for each `<details>` section
   - Modify `renderUI()` to iterate groups instead of flat list
   - Update event listeners for collapse/expand toggle

5. **Event Handling**:
   - Listen to `<details>` `toggle` event to save collapse state
   - Update storage when groups expanded/collapsed
   - Prevent event bubbling to Quick Tab action buttons

### State Tracking Architecture

```javascript
// New state structure in Manager
const tabGroupCollapseState = new Map(); // tabId -> boolean (isExpanded)

// Example after grouping:
const groupedQuickTabs = {
  "42": {
    tabId: 42,
    tabTitle: "Shigure Ui - Wikipedia",
    tabUrl: "https://en.wikipedia.org/wiki/Shigure_Ui",
    quickTabs: [...],
    isExpanded: true
  },
  "14": {
    tabId: 14,
    tabTitle: "Japan - Wikipedia",
    tabUrl: "https://en.wikipedia.org/wiki/Japan",
    quickTabs: [...],
    isExpanded: true
  },
  "8": {
    tabId: 8,
    tabTitle: "Google Search",
    tabUrl: "https://www.google.com",
    quickTabs: [...],
    isExpanded: false
  }
}
```

### Data Flow

```
Storage Update (all Quick Tabs)
         ↓
    loadQuickTabsState()
         ↓
    groupQuickTabsByOriginTabId()
         ↓
    Add tab titles via browser.tabs.query()
         ↓
    Merge with collapse state (sessionStorage)
         ↓
    renderUI()
         ↓
    For each group, create <details> element
         ↓
    Render Quick Tabs within each <details>
```

### Browser Support

- `<details>` and `<summary>` elements: Supported in all modern browsers (Firefox 49+, Chrome 12+, Safari 6+)
- No JavaScript required for basic collapse/expand functionality (native browser support)
- JavaScript only needed for state persistence

### Accessibility

- `<details>` elements are semantic and accessible by default
- Screen readers announce expand/collapse state
- Keyboard navigation works (Enter/Space on header to toggle)
- Arrow icon (▼/▸) is visual-only, not essential for understanding

---

## Missing Components for Implementation

### Data Requirements
- Browser tab title/URL for each group header (need to look up via `browser.tabs.get()`)
- Tab ID extraction from Quick Tab's `originTabId` field
- Collapse state persistence mechanism

### UI Components
- Tab group header styling (thinner than Quick Tab items)
- Nested Quick Tab item styling (indented/visually distinct)
- `<details>` element styling and animations
- Collapse/expand arrow styling

### JavaScript Functions
- `groupQuickTabsByOriginTabId(quickTabs)` - Group data
- `getTitleForTabId(tabId)` - Look up browser tab title
- `loadCollapseState()` - Restore from sessionStorage
- `saveCollapseState()` - Persist state
- `renderTabGroup(groupId, groupData)` - Render single group
- `renderUI()` - Refactored to use grouping

### Event Listeners
- `details.addEventListener('toggle', ...)` - Save collapse state
- Tab closure detection (update groups if a tab closes)
- Real-time updates when new Quick Tabs created in different tabs

### Edge Cases
- Quick Tab in closed browser tab (orphaned)
- No Quick Tabs in manager (empty state)
- Very long list of browser tabs
- Tab title contains special characters
- Same URL opened in multiple tabs (need to distinguish by Tab ID)
