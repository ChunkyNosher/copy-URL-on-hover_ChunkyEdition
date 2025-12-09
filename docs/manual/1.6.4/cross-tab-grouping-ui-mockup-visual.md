# Quick Tabs Manager: Cross-Tab Grouping UI - Visual Mockup

## Current UI Layout

```
┌───────────────────────────────────────────────────────────┐
│  Quick Tabs Manager                                       │
│  [Close Minimized]              [Close All]               │
├───────────────────────────────────────────────────────────┤
│ 5 Quick Tabs  |  Last sync: 14:32:15                     │
├───────────────────────────────────────────────────────────┤
│                                                           │
│ 📑 All Quick Tabs (5 tabs)                               │
│                                                           │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 🟢 📖 Wikipedia: Shigure Ui - Wikipedia              │  │
│ │     800×600 • Minimized                             │  │
│ │     [🔗] [➖] [✕]                                    │  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 🟢 📖 Wikipedia: Japan - Wikipedia                   │  │
│ │     800×600                                         │  │
│ │     [🔗] [➖] [✕]                                    │  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 🟡 📖 Wikipedia: Tokyo - Wikipedia                   │  │
│ │     Minimized • 1024×768 at (200, 100)             │  │
│ │     [↑] [✕]                                         │  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**Characteristics:**

- Single monolithic "All Quick Tabs" section header
- All Quick Tabs listed in flat hierarchy with no visual grouping
- Large individual item containers
- No indication which browser tab each Quick Tab belongs to
- No way to collapse/minimize related Quick Tabs
- Scrolling required when many Quick Tabs exist

---

## Proposed UI Layout: Cross-Tab Grouping with Collapsible Groups

```
┌───────────────────────────────────────────────────────────┐
│  Quick Tabs Manager                                       │
│  [Close Minimized]              [Close All]               │
├───────────────────────────────────────────────────────────┤
│ 5 Quick Tabs  |  Last sync: 14:32:15                     │
├───────────────────────────────────────────────────────────┤
│                                                           │
│ ▼ 🔗 Shigure Ui - Wikipedia (Tab 42)                    │
│   [2 Quick Tabs]                                        │
│                                                           │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 🟢 📖 Wikipedia: Shigure Ui                      │   │
│   │     800×600                                     │   │
│   │     [🔗] [➖] [✕]                                │   │
│   └─────────────────────────────────────────────────┘   │
│                                                           │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 🟡 📖 Wikipedia: Shigure Ui (Copy)               │   │
│   │     Minimized                                   │   │
│   │     [↑] [✕]                                     │   │
│   └─────────────────────────────────────────────────┘   │
│                                                           │
│ ▼ 🔗 Japan - Wikipedia (Tab 14)                         │
│   [3 Quick Tabs]                                        │
│                                                           │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 🟢 📖 Wikipedia: Japan Overview                  │   │
│   │     1024×768                                    │   │
│   │     [🔗] [➖] [✕]                                │   │
│   └─────────────────────────────────────────────────┘   │
│                                                           │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 🟢 📖 Wikipedia: Japan Geography                 │   │
│   │     1024×768 at (300, 150)                      │   │
│   │     [🔗] [➖] [✕]                                │   │
│   └─────────────────────────────────────────────────┘   │
│                                                           │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 🟡 📖 Wikipedia: Japan History                   │   │
│   │     Minimized                                   │   │
│   │     [↑] [✕]                                     │   │
│   └─────────────────────────────────────────────────┘   │
│                                                           │
│ ▸ 🔗 Google Search (Tab 8)                              │
│   [1 Quick Tab]                                         │
│   (Collapsed - content hidden)                          │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**Characteristics:**

- Multiple thin group headers, one per browser tab
- Each group header shows: expand/collapse arrow, favicon, browser tab title,
  tab ID, Quick Tab count
- All Quick Tabs grouped under their originating browser tab
- Groups can be independently collapsed/expanded (collapse arrow changes from ▼
  to ▸)
- Collapsed groups hide their child Quick Tabs
- Nested Quick Tab items visually indented
- Much better space utilization when tabs have many Quick Tabs
- Clearer organization when managing Quick Tabs across multiple browser tabs

---

## Visual Design Details

### Tab Group Header (Collapsible)

**When Expanded (▼):**

```
▼ 🔗 Shigure Ui - Wikipedia (Tab 42)    [2 Quick Tabs]
```

**When Collapsed (▸):**

```
▸ 🔗 Shigure Ui - Wikipedia (Tab 42)    [1 Quick Tab]
```

**Header Components:**

1. **Expand/Collapse Arrow** (▼/▸)
   - Left-aligned
   - Clickable to toggle group visibility
   - Smooth animation between states
   - Part of native HTML `<details>` element

2. **Tab Favicon** (🔗)
   - Links icon as placeholder
   - Could be actual favicon from browser tab URL (optional enhancement)
   - Provides visual indicator this is a browser tab grouping

3. **Browser Tab Title** (e.g., "Shigure Ui - Wikipedia")
   - From `browser.tabs.get()` API
   - Truncated with ellipsis if too long
   - Shows what the user is doing in that tab

4. **Tab ID** (e.g., "Tab 42")
   - In parentheses for clarity
   - Small, lighter font weight
   - For debugging and user reference

5. **Quick Tab Count** (e.g., "[2 Quick Tabs]")
   - Right-aligned
   - Light color (secondary text)
   - Plural "Tabs" or singular "Tab"
   - Shows count of child Quick Tabs at a glance

**Header Styling:**

- Background: Slightly darker/lighter than Quick Tab items (distinct but not
  jarring)
- Padding: 6-8px horizontal, 4-6px vertical (thinner than Quick Tab items at
  10px)
- Border: None or very subtle separator
- Font: Bold or semi-bold for emphasis
- Cursor: Pointer to indicate clickability
- Hover: Slight background color change to indicate interactive
- Animation: Smooth expand/collapse transition (0.2-0.3s)

---

### Quick Tab Items (Nested)

**Visual Structure:**

```
   ┌─────────────────────────────────────────────────┐
   │ 🟢 📖 Wikipedia: Japan Overview                  │
   │     1024×768 at (300, 150)                      │
   │     [🔗] [➖] [✕]                                │
   └─────────────────────────────────────────────────┘
```

**When Part of a Group (Indented):**

- Left padding increased by ~12-16px compared to non-grouped items
- Left border preserved (3px green/yellow) but may be indented or nested
  visually
- Slightly smaller overall (optional - could maintain same size)
- Background same as parent or subtly different (optional alternating colors)

**When in Collapsed Group:**

- Completely hidden (display: none or collapsed with `<details>`)
- Not taking up space
- Can re-expand to view

**Item Contents Unchanged:**

- Status indicator dot (🟢 green, 🟡 yellow, 🟠 orange)
- Favicon image
- Tab title
- Metadata (size, position, minimized state)
- Action buttons (Go To Tab, Minimize/Restore, Close)

---

## Spacing and Layout Hierarchy

### Vertical Spacing

```
Header (sidebar-header)
│ Padding: 12px 16px
│ Contains: Title, buttons
│
├─ Gap: 0px (border directly below)
│
Stats Bar (sidebar-stats)
│ Padding: 8px 16px
│ Contains: Tab count, last sync
│
├─ Gap: 0px (border directly below)
│
Containers List (containers-list)
│ Padding: 10px 0px
│ Contains: Tab groups
│
├─ Tab Group #1
│  ├─ Group Header
│  │  Padding: 6px 16px (thinner than items)
│  │  Border: Top and bottom subtle separator
│  │
│  ├─ Quick Tabs List (when open)
│  │  ├─ Quick Tab Item #1
│  │  │  Padding: 10px 16px, but left-indented +12px
│  │  │  Border-left: 3px colored
│  │  │
│  │  ├─ Quick Tab Item #2
│  │  │  Padding: 10px 16px, but left-indented +12px
│  │  │  Border-left: 3px colored
│  │
│  └─ (Hidden when collapsed)
│
├─ Spacing between groups: 8-12px (subtle gap)
│
├─ Tab Group #2
│  ├─ Group Header
│  ├─ Quick Tabs List (when open)
│
└─ (Repeat for each group)
```

### Horizontal Alignment

```
Group Header:
|▼ 🔗 Tab Title (Tab ID)                [2 Quick Tabs]|
 └─ Arrow: 2-4px from edge
    └─ Icon: 6-8px after arrow
       └─ Title: 6px after icon (expands to fill)
          └─ Count: Right-aligned with padding

Quick Tab Item (Nested):
|   🟢 📖 Title                [Go] [Min] [Close]|
 └─ Indent: 12-16px left padding
    └─ Indicator: 2-4px from edge
       └─ Icon: 6-8px after indicator
          └─ Content: Fills middle
             └─ Buttons: Right-aligned (fixed width)
```

---

## Collapse/Expand Behavior

### Expand State (▼)

- Arrow points downward
- Child Quick Tabs visible
- All spacing and styling normal
- Click arrow to collapse

### Collapse State (▸)

- Arrow points rightward (or to-the-right angle)
- Child Quick Tabs completely hidden
- Group header remains visible
- Click arrow to expand
- Count still shows (helpful for user to know how many tabs to expect when
  expanded)

### Animation

- Arrow rotation smooth (0.2-0.3 seconds)
- Content fade-in/fade-out or height collapse animation (optional but enhances
  UX)
- Transition feels responsive but not jarring
- Accessibility: Works with keyboard (Enter/Space on focused header)

### State Persistence

- User's collapse/expand preferences saved in sessionStorage
- When Manager reloads, groups return to previously expanded/collapsed state
- Default: All groups expanded initially (most useful for first-time users)

---

## Color and Visual Coding

### Group Headers

| Element    | Light Mode | Dark Mode |
| ---------- | ---------- | --------- |
| Background | #f5f5f5    | #1e1e1e   |
| Text       | #333333    | #e0e0e0   |
| Border     | #ddd       | #555      |
| Hover BG   | #ececec    | #272727   |

### Quick Tab Items (Nested)

| Element                     | Light Mode | Dark Mode |
| --------------------------- | ---------- | --------- |
| Background                  | #ffffff    | #2d2d2d   |
| Text                        | #333333    | #e0e0e0   |
| Border (Green - active)     | #4caf50    | #4caf50   |
| Border (Yellow - minimized) | #ffc107    | #ffc107   |
| Hover BG                    | #f5f5f5    | #353535   |
| Indent border               | #ddd       | #555      |

### Status Indicators

| State       | Color   | Meaning                                  |
| ----------- | ------- | ---------------------------------------- |
| Green (🟢)  | #4caf50 | Active, rendered in browser              |
| Yellow (🟡) | #ffc107 | Minimized, not rendered                  |
| Orange (🟠) | #ff9800 | Warning - restore failed, may need retry |

---

## Responsive Design Considerations

### Desktop View (Current)

- 350-400px sidebar width
- Comfortable padding and spacing
- All elements clearly visible
- No truncation needed for most tab titles

### Compact View (Optional Future)

- Could reduce padding for smaller sidebars
- Truncate tab titles more aggressively
- Smaller font sizes
- Still maintain hierarchy and usability

### Minimum Requirements

- Must work at 250px width (emergency minimum)
- Tab title truncates with ellipsis
- Quick Tab count always visible
- Action buttons remain accessible
- No horizontal scrolling

---

## Accessibility Features

### Keyboard Navigation

- Tab key cycles through headers and buttons
- Enter/Space toggles group expand/collapse when header focused
- All buttons keyboard accessible
- Focus outline visible (outline: 2px solid)

### Screen Reader Support

- `<details>/<summary>` semantic HTML provides native support
- Screen readers announce "expandable" status of group headers
- Quick Tab count announced
- Status indicators announced via title attributes or aria-labels

### Color Contrast

- All text meets WCAG AA contrast ratios (4.5:1 for normal text)
- Status indicators (colored dots) not sole way to convey information
- Text labels always present (e.g., "Minimized" in metadata)

### Focus Management

- Focus visible outline on all interactive elements
- No focus traps
- Tab order logical (headers first, buttons after title in each item)

---

## Comparison: Scenarios

### Scenario 1: User with 2 Open Tabs, 5 Total Quick Tabs

**Current UI:**

- Scrolls through 5 items in flat list
- No indication which Quick Tab belongs to which tab
- Might minimize or restore wrong Quick Tab by mistake

**Proposed UI:**

```
▼ Wikipedia Tab (Tab 42) [3 Quick Tabs]
  - 3 Quick Tab items visible

▼ Google Tab (Tab 8) [2 Quick Tabs]
  - 2 Quick Tab items visible
```

- Immediately clear which Quick Tabs belong where
- Can collapse "Wikipedia Tab" group to focus on "Google Tab" group
- Reduces cognitive load

### Scenario 2: User with 5 Open Tabs, 20+ Total Quick Tabs

**Current UI:**

- Very long scrolling list
- Hard to remember which Quick Tab belongs to which browser tab
- Takes up huge amount of vertical space

**Proposed UI:**

```
▸ Email Tab (Tab 3) [6 Quick Tabs]
  (collapsed, just shows header)

▼ News Site 1 (Tab 14) [4 Quick Tabs]
  - 4 Quick Tab items visible

▸ News Site 2 (Tab 19) [3 Quick Tabs]
  (collapsed)

▼ Shopping Tab (Tab 25) [4 Quick Tabs]
  - 4 Quick Tab items visible

▸ Social Media (Tab 31) [3 Quick Tabs]
  (collapsed)
```

- User can collapse unneeded groups to declutter view
- Focus on specific browser tab's Quick Tabs
- Much better space utilization
- Easier to manage many Quick Tabs

### Scenario 3: User Reopens Browser Tab

**Current UI:**

- Quick Tabs still show in Manager
- No indication they're "orphaned" (from a closed tab)

**Proposed UI:**

```
▸ Wikipedia (Closed) - Tab 42 [2 Quick Tabs]
  (grayed out, indicates tab no longer exists)
```

- Clear indication tab was closed
- User can decide to close orphaned Quick Tabs or wait for tab to reopen
- Better transparency about state

---

## UI Interaction Patterns

### Expand Tab Group

1. User clicks expand arrow (▼)
2. Arrow rotates to ▸
3. Child Quick Tab items slide/fade in
4. Group header remains in place
5. State saved to sessionStorage

### Collapse Tab Group

1. User clicks collapse arrow (▸)
2. Arrow rotates to ▼
3. Child Quick Tab items slide/fade out
4. Group header remains visible showing tab count
5. State saved to sessionStorage

### Minimize Quick Tab

1. User clicks minimize button (➖) on active Quick Tab
2. Quick Tab item remains visible in group
3. Item styling changes to show minimized state (yellow indicator)
4. Action button changes to restore (↑)
5. Can still interact with Quick Tab from Manager

### Restore Quick Tab

1. User clicks restore button (↑) on minimized Quick Tab
2. Quick Tab renders in browser
3. Item styling changes to show active state (green indicator)
4. Action button changes to minimize (➖)

### Close Quick Tab

1. User clicks close button (✕)
2. Quick Tab item removed from group
3. If group becomes empty, group header may be hidden or show "No Quick Tabs"
4. Quick Tab count in group header updates
5. If last tab in group, group may be hidden entirely

### Collapse and Navigate

1. User collapses "Email Tab" group to hide its Quick Tabs
2. User focuses on "News Site" group's Quick Tabs
3. User can minimize/restore/close Quick Tabs in visible group
4. Group stays collapsed until user clicks to expand
5. On next session, group remains collapsed (state saved)

---

## Empty States

### No Quick Tabs in Manager

```
┌───────────────────────────────────────────────────────────┐
│  Quick Tabs Manager                                       │
│  [Close Minimized]              [Close All]               │
├───────────────────────────────────────────────────────────┤
│ 0 Quick Tabs  |  Last sync: Never                         │
├───────────────────────────────────────────────────────────┤
│                                                           │
│              📭                                           │
│                                                           │
│              No Quick Tabs                               │
│                                                           │
│    Press Q while hovering over a link to create one      │
│                                                           │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### Tab Group with No Quick Tabs (After Closing All)

- Group header remains but appears grayed out or with different styling
- Shows "0 Quick Tabs"
- Optional: Show message "All Quick Tabs in this tab closed"
- Optional: Auto-remove empty group after 5-10 seconds

---

## Edge Cases and Special States

### Browser Tab is Closed (Orphaned Quick Tabs)

```
▸ Wikipedia [CLOSED] (Tab 42)    [2 Quick Tabs]
  (grayed out, tab doesn't exist)
```

- Header styling slightly different (reduced opacity or gray color)
- Label indicates "CLOSED" or "[Closed]"
- User can still manage Quick Tabs (restore/minimize/close)
- Optional: Show warning or "close all in this group" button

### Very Long Tab Title

```
▼ This is a very long Wikipedia article about something... (Tab 42)
  [3 Quick Tabs]
```

- Title truncates with ellipsis at end
- Full title shown on hover as tooltip
- Tab ID always visible

### Quick Tab Count Exceeds Space

```
▼ Tab Title (Tab 42)    [999 Quick Tabs]
```

- Font size reduced if needed
- Never truncates (showing count is important)
- Can be on second line if absolutely necessary

### Grouped Items in Different Minimize States

```
▼ Wikipedia Tab (Tab 42) [3 Quick Tabs]
  🟢 Active Tab 1 [actions]
  🟢 Active Tab 2 [actions]
  🟡 Minimized Tab [actions]
```

- Active items listed first with green indicator
- Minimized items follow with yellow indicator
- Within groups, order maintained: active first, then minimized
- Each item independent (can minimize/restore individually)

---

## Summary of Visual Improvements

| Aspect           | Current                    | Proposed                      |
| ---------------- | -------------------------- | ----------------------------- |
| Organization     | Flat list                  | Hierarchical by tab           |
| Scalability      | Poor (long lists)          | Good (collapsible groups)     |
| User Context     | No indication of ownership | Clear tab ownership per group |
| Space Efficiency | Low (all expanded)         | High (collapse unused groups) |
| Navigation       | Scroll through all         | Focus on specific tab group   |
| Clarity          | Ambiguous                  | Clear visual hierarchy        |
| Interaction      | Passive view               | Active management             |
| Accessibility    | Basic                      | Semantic HTML (details)       |
