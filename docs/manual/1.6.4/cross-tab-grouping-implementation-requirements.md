# Quick Tabs Manager: Cross-Tab Grouping Feature - Implementation Requirements

**Extension Version:** v1.6.3.6 | **Date:** 2025-12-08 | **Scope:** Multiple
architectural gaps preventing cross-tab Quick Tab aggregation with collapsible
grouping UI

---

## Executive Summary

The current Quick Tabs Manager displays all Quick Tabs in a flat global list
with no organization by origin tab. To implement the requested cross-tab
grouping feature, seven distinct architectural and implementation gaps must be
addressed. These issues span data organization, UI rendering, state persistence,
browser tab integration, and event handling. While each issue is independent,
all must be fixed in a single coordinated effort because the feature requires
integration across the entire Manager component lifecycle.

## Issues Overview

| Issue                                     | Component            | Severity | Root Cause                                              |
| ----------------------------------------- | -------------------- | -------- | ------------------------------------------------------- |
| #1: Missing data grouping logic           | Manager data layer   | Critical | No groupBy implementation for originTabId               |
| #2: Browser tab metadata unavailable      | Manager integration  | Critical | No browser.tabs lookup for group headers                |
| #3: Collapse state mechanism missing      | Manager state        | High     | No sessionStorage persistence for collapse state        |
| #4: HTML structure lacks details elements | Manager template     | High     | Current HTML uses flat div structure, needs `<details>` |
| #5: CSS doesn't support nested grouping   | Manager styles       | High     | No styling for group headers or nested tab items        |
| #6: Event listeners incomplete            | Manager interactions | High     | No handlers for details toggle or tab closure detection |
| #7: Render logic not refactored           | Manager rendering    | Critical | Current renderUI() doesn't group tabs before rendering  |

**Why bundled:** All seven issues are prerequisites for a single feature. The
feature cannot function if any one is missing. They affect different layers
(data, UI, state, events) but must work together for the complete
implementation. Fixing requires coordinated changes across all Manager files.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (data grouping, render logic, event handlers, state persistence)
- `sidebar/quick-tabs-manager.html` (add container div for sessionStorage collapse state if needed)
- `sidebar/quick-tabs-manager.css` (add tab group header and nested tab item styles)

**Do NOT Modify:**

- `src/features/quick-tabs/` (tab creation and restoration logic - already
  provides originTabId)
- `src/background/` (storage architecture is correct)
- `src/content.js` (message handling)
- Event emission from handlers (all handlers already emit proper events)
  </scope>

---

## Issue #1: Missing Data Grouping Logic

### Problem

Manager loads all Quick Tabs as a flat array from storage and renders them in a
single undifferentiated list. There is no code to organize Quick Tabs by their
`originTabId` field (which browser tab they belong to).

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `renderUI()` function (lines 830-900) and supporting extraction
functions  
**Issue:** The code extracts tabs from storage using `extractTabsFromState()`
which returns a flat array. It then immediately separates tabs into `activeTabs`
and `minimizedTabs` for rendering, but never groups by `originTabId`. The
rendering code creates a single `createGlobalSection()` and renders all tabs
into it without any grouping hierarchy.

### Fix Required

Implement a data grouping function that reorganizes the flat Quick Tabs array
into a nested structure keyed by `originTabId`. The function should use
`Object.groupBy()` (ES2024 native) or a `reduce()`-based fallback for older
environments. Group structure should preserve order of browser tabs as they
appear in the system and maintain active-tabs-first sorting within each group.
After grouping, validate that all `originTabId` values are present or can be
extracted from the Quick Tab ID pattern (format: `qt-{tabId}-*`). The grouped
data structure should be compatible with the new rendering logic that needs to
iterate groups instead of flat arrays.

---

## Issue #2: Browser Tab Metadata Unavailable

### Problem

The group headers for each browser tab need to display the tab's title and URL
(e.g., "Shigure Ui - Wikipedia (Tab 42)"). Manager has no way to look up this
metadata because it doesn't query `browser.tabs.query()` to get information
about browser tabs.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `renderUI()` function and `renderTabGroup()` (doesn't exist yet)  
**Issue:** The current code initializes container info from
`browser.contextualIdentities.query()` in `loadContainerInfo()` but never
queries `browser.tabs.query()` to get information about open browser tabs. When
the tab group headers are rendered, the code has the `originTabId` but no
corresponding title, URL, or other metadata. There is no caching mechanism to
avoid repeated queries for the same tab IDs.

### Fix Required

Query `browser.tabs.query({})` once at Manager initialization and cache the
results in a Map keyed by tab ID. When rendering tab groups, look up the tab ID
in this cache to get title and URL. Implement graceful fallback for orphaned
Quick Tabs (tabs that have been closed) - show a generic header like "Unknown
Tab (Tab 42) [Closed]" instead of crashing. Update the cache dynamically when
tabs are created/closed if possible (may require background script
coordination). Ensure tab lookup doesn't block the UI - perform the lookup
asynchronously and update the group header title after cache is ready. Consider
caching tab metadata in `sessionStorage` to improve performance across Manager
reloads within the same browsing session.

---

## Issue #3: Collapse State Mechanism Missing

### Problem

The proposed UI includes collapsible tab groups that can be expanded or
collapsed by clicking the group header. Currently, there is no mechanism to
persist which groups are expanded/collapsed, so the state resets every time the
Manager panel is opened or the sidebar refreshes.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** No collapse state tracking exists anywhere in the file  
**Issue:** The code initializes multiple state Maps and variables
(`quickTabsState`, `containersData`, `quickTabHostInfo`, `inMemoryTabsCache`,
etc.) but never initializes a structure to track collapse state. There is no
code that reads collapse state from storage before rendering, and no event
listeners for the `toggle` event on `<details>` elements to capture when the
user clicks collapse/expand arrows.

### Fix Required

Create a new Map called `tabGroupCollapseState` (or similar) that maps `tabId` →
`boolean` (true = expanded, false = collapsed). Initialize this Map during
DOMContentLoaded by reading from `sessionStorage` (key:
`manager_tab_groups_collapse_state`). When rendering tab groups, check this Map
to set the `open` attribute on `<details>` elements. Add an event listener that
fires when any `<details>` element toggles its state - capture the toggle event,
extract the tab ID from the element's `data-tab-id` attribute, update the Map,
and persist the new state to `sessionStorage`. Default behavior should be to
expand all groups initially (all groups `open` by default) unless the user has
previously collapsed them. Consider using a more persistent storage mechanism
(like `browser.storage.local`) if the user expects collapse state to survive
across browsing sessions, but `sessionStorage` is acceptable if collapse state
only needs to survive page reloads.

---

## Issue #4: HTML Structure Lacks Details Elements

### Problem

The proposed UI uses HTML5 `<details>` and `<summary>` elements to create
semantic, accessible collapsible sections. The current HTML structure doesn't
support this - it's a flat div hierarchy created entirely by JavaScript.

### Root Cause

**File:** `sidebar/quick-tabs-manager.html`  
**Location:** Lines 21-24 (the containersList div)  
**Issue:** The HTML file has a single
`<div id="containersList" class="containers-list">` that is populated entirely
by JavaScript code in `renderUI()`. The code creates generic divs with classes
like `container-section` and `quick-tabs-list`. There is no semantic HTML
structure - no `<details>` or `<summary>` elements, no semantic grouping
markers.

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `createGlobalSection()` function and `renderUI()` (lines
830-900)  
**Issue:** The rendering code builds HTML using `document.createElement()` to
create divs, but never creates `<details>` or `<summary>` elements. The global
section header is created as a plain div with class `container-header`, not as a
semantic structure. The code appends all tabs directly into `quick-tabs-list`
without grouping.

### Fix Required

Modify the JavaScript rendering logic to create `<details>` elements instead of
plain divs for each tab group. Each `<details>` should contain:

- A `<summary>` element for the clickable group header (not a plain div)
- A `data-tab-id` attribute on the `<details>` element for identifying which tab
  group it represents
- A div with class `quick-tabs-list` inside the `<details>` that contains the
  actual Quick Tab item divs

The `<summary>` should contain the group header content (expand/collapse icon,
tab favicon, tab title, tab ID, Quick Tab count). The structure should look like
semantic HTML structure as shown in the mockup document. Remove the existing
`createGlobalSection()` function and replace it with new functions like
`createTabGroup()` that creates the proper `<details>` structure. No HTML
changes needed to the main sidebar template - all structure can be built
dynamically by JavaScript.

---

## Issue #5: CSS Doesn't Support Nested Grouping

### Problem

The current CSS styles all Quick Tabs as direct children with uniform padding
and styling. The new design needs distinct styles for tab group headers
(thinner, different background) and nested Quick Tab items (indented/nested
appearance).

### Root Cause

**File:** `sidebar/quick-tabs-manager.css`  
**Location:** Lines 1-200 (entire stylesheet)  
**Issue:** The CSS defines `.container-header` styling (lines 93-105) and
`.quick-tab-item` styling (lines 117-130) but doesn't account for a nested
structure. The `.container-header` style assumes a flat grouping structure (used
for container tabs in the old model). The `.quick-tab-item` has a left border
(`border-left: 3px`) and padding that assumes it's a top-level item, not a
nested child of a group. There are no styles for `.tab-group-header` (thin group
headers) or `.quick-tab-item.grouped` (nested appearance).

### Fix Required

Create new CSS classes for the tab group structure:

- `.tab-group` (for `<details>` elements) - minimal styling, likely just spacing
- `.tab-group-header` (for `<summary>` elements) - thinner than current
  `.quick-tab-item` (reduce padding from 10px to 6-8px), distinct background
  color (slightly lighter or darker), cursor pointer, font weight for emphasis,
  possibly a small margin/border to separate from Quick Tab items
- `.quick-tab-item.grouped` - for Quick Tab items nested inside tab groups - add
  left indentation (increase left padding by 8-12px), possibly a left border or
  different background color, visual distinction from group header
- Update `.quick-tab-item` base styles to work both as grouped and non-grouped
  items (selector specificity so `.grouped` overrides base styles)
- Style the expand/collapse arrow/icon in the `<summary>` (use CSS `::marker`
  for the built-in arrow, or override with custom icon)
- Add smooth transition/animation for open/close state (CSS `transition` on
  max-height or transform if animating)
- Ensure keyboard focus/accessibility - `.tab-group-header:focus-visible` should
  have outline

---

## Issue #6: Event Listeners Incomplete

### Problem

The current Manager has event listeners for user interactions on Quick Tab
action buttons and storage changes, but it's missing critical listeners for the
new collapsible group behavior and for detecting when browser tabs are closed
(which would orphan their Quick Tabs).

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `setupEventListeners()` function (lines 600-650) and delegated
event handler in `containersList` listener (lines 653-682)  
**Issue:** The code listens to `containersList.addEventListener('click', ...)`
for Quick Tab action buttons, which works for dynamically created elements via
event delegation. However, there's no listener for the `toggle` event that fires
when a `<details>` element's open state changes. The code has no listener for
`browser.tabs.onRemoved` or similar to detect when a browser tab is closed and
update the grouping accordingly. The event delegation approach will work for the
new `<summary>` elements (click events bubble), but the `toggle` event specific
to `<details>` needs a separate listener because it doesn't bubble.

### Fix Required

Add a `toggle` event listener to the `containersList` parent element that
captures toggle events from `<details>` elements. Extract the `data-tab-id` from
the toggled `<details>` element and update the `tabGroupCollapseState` Map.
Persist the new state to `sessionStorage` immediately. The `toggle` event
bubbles in some browsers but not consistently across all versions, so either use
event capturing or add individual listeners to each `<details>` element during
rendering. Consider using `browser.tabs.onRemoved` or similar Firefox API to
detect when a browser tab is closed - when a tab is closed, find all Quick Tabs
with matching `originTabId` and update the UI (either hide the group or show
"Closed Tab" indicator). Alternatively, if detecting tab closure is complex,
implement a "cleanup" mechanism that periodically checks if tab groups exist in
the browser tab system - during `renderUI()` or on a timer, validate that each
tab ID in the grouped data still exists via `browser.tabs.get(tabId)`. Handle
the error case gracefully when a tab is closed.

---

## Issue #7: Render Logic Not Refactored

### Problem

The current `renderUI()` function is tightly coupled to rendering a flat list of
Quick Tabs. To implement grouping, the entire rendering logic needs to be
refactored to iterate over grouped data instead of a flat array and render group
headers alongside their child tabs.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `renderUI()` function (lines 830-900)  
**Issue:** The function currently:

1. Extracts tabs using `extractTabsFromState()` (returns flat array)
2. Separates into `activeTabs` and `minimizedTabs`
3. Creates global section header via `createGlobalSection()`
4. Renders all tabs into a single list by calling `renderQuickTabItem()` for
   each tab
5. Appends to containersList

The code has no code to group tabs before rendering, no code to create group
headers, no code to render tabs within groups. The `renderQuickTabItem()`
function assumes a flat structure and creates Quick Tab items that would be
siblings in the list. To support grouping, the logic must:

1. Group the flat array by originTabId
2. For each group, create a group container (`<details>` element)
3. For each group, render a group header (`<summary>`)
4. For each Quick Tab within the group, render the tab item (nested inside the
   group)
5. Handle empty groups and orphaned tabs

This requires significant restructuring of the render pipeline.

### Fix Required

Refactor `renderUI()` to work with grouped data instead of flat data. Extract
the grouping logic into a separate function
`groupQuickTabsByOriginTabId(quickTabs)` that returns an object mapping tab IDs
to group data. Create a new function `renderTabGroup(tabId, groupData)` that
renders a single `<details>` element with group header and nested Quick Tab
items. Modify the main `renderUI()` to iterate over the grouped data and call
`renderTabGroup()` for each group instead of directly rendering tabs. Update
`renderQuickTabItem()` to accept an optional parameter indicating whether the
item is nested (`isGrouped` or similar) - if nested, apply grouping styles.
Extract browser tab lookup logic into a helper function
`_lookupTabMetadata(tabId)` that returns cached tab info or a fallback object.
The rendering should maintain the order of tab groups as they appear in the
system and sort tabs within each group (active first, then minimized). Ensure
the function handles empty groups gracefully (don't render group if no tabs, or
show empty state within group if desired). Preserve the existing stat updates
(`updateUIStats()`) and empty state detection logic.

---

## Shared Implementation Architecture

### Data Flow for Grouping

The new data flow should be:

1. Load flat array from storage via `loadQuickTabsState()`
2. Group flat array using `groupQuickTabsByOriginTabId()` → returns
   `Map<tabId, GroupData>`
3. Enrich groups with browser tab metadata using cached data from
   `browser.tabs.query()`
4. Merge with collapse state from `sessionStorage`
5. Pass grouped data to `renderUI()` which iterates groups and calls
   `renderTabGroup()`
6. Render complete UI with group headers and nested tabs

### State Structure After Grouping

After grouping, the data structure should look like:

```
Map {
  42 → {
    tabId: 42,
    title: "Shigure Ui - Wikipedia",
    url: "https://en.wikipedia.org/wiki/Shigure_Ui",
    favicon: (URL or null),
    quickTabs: [/* array of 2 Quick Tab objects */],
    isExpanded: true  // from collapse state
  },
  14 → {
    tabId: 14,
    title: "Japan - Wikipedia",
    ...
    quickTabs: [/* array of 3 Quick Tab objects */],
    isExpanded: true
  }
}
```

### Collapse State Persistence

Collapse state is stored in `sessionStorage` with key
`manager_tab_groups_collapse_state` as JSON:

```json
{
  "42": true,
  "14": true,
  "8": false
}
```

When a `<details>` toggle event fires, extract the tab ID from the element,
update the Map in memory, and persist immediately to `sessionStorage`.

### Browser Tab Metadata Caching

Browser tab info is queried once during `DOMContentLoaded` and cached:

```javascript
const tabMetadataCache = new Map(); // tabId → {title, url, favicon}
```

When rendering groups, look up tab ID in cache. If not found (tab was closed),
show fallback "Unknown Tab" header. If needed in the future, implement cache
invalidation by listening to `browser.tabs.onRemoved` and
`browser.tabs.onUpdated`.

### Orphaned Tabs Handling

If a Quick Tab has an `originTabId` that no longer exists in the browser (tab
was closed), the tab group should either:

1. Not render (tabs are hidden/removed) - simplest but data is lost if tab is
   reopened
2. Show "Tab Closed" indicator with option to close the orphaned Quick Tabs
3. Show tabs in a special "Orphaned Quick Tabs" section at the bottom

Current recommendation is option 2 - show the closed tab header with a visual
indicator (grayed out, "Closed" label), and allow user to explicitly close the
orphaned Quick Tabs via the normal close button.

<acceptance_criteria> **Issue #1:**

- [ ] Grouping function exists and groups by originTabId
- [ ] Fallback extraction works for tabs with null originTabId
- [ ] Groups preserve browser tab order
- [ ] Tabs within groups sorted: active first, then minimized

**Issue #2:**

- [ ] Browser tab metadata queried on Manager load
- [ ] Tab info cached in Map or similar
- [ ] Group headers display: "Page Title - Domain (Tab {id})"
- [ ] Orphaned tabs (closed browser tabs) handled gracefully with fallback text

**Issue #3:**

- [ ] tabGroupCollapseState Map initialized and managed
- [ ] Collapse state persisted to sessionStorage
- [ ] State restored on Manager reload
- [ ] Details elements reflect stored collapse state

**Issue #4:**

- [ ] HTML uses `<details>` and `<summary>` elements for groups
- [ ] Each `<details>` has data-tab-id attribute
- [ ] `<summary>` contains all group header content (icon, title, count)
- [ ] No breaking changes to existing Quick Tab item HTML

**Issue #5:**

- [ ] .tab-group-header styles applied (thinner, distinct appearance)
- [ ] .quick-tab-item.grouped styles applied (indented/nested)
- [ ] Collapse animation smooth (if CSS animation used)
- [ ] Focus states accessible for keyboard navigation
- [ ] Dark mode colors correctly inherited

**Issue #6:**

- [ ] toggle event listener captures details toggle events
- [ ] Collapse state updated immediately on toggle
- [ ] Browser tab closure detected (if implemented)
- [ ] UI updates when tab is closed
- [ ] No errors in console for missing tab IDs

**Issue #7:**

- [ ] renderUI() refactored to work with grouped data
- [ ] groupQuickTabsByOriginTabId() function exists and works
- [ ] renderTabGroup() function renders complete group with header
- [ ] Tab groups render in order with correct nested structure
- [ ] Stats and empty state still work correctly
- [ ] All existing quick tab actions (minimize, restore, close) still work

**All Issues:**

- [ ] Feature works with both active and minimized tabs
- [ ] Feature works with single and multiple origin tabs
- [ ] Empty state shows when no Quick Tabs
- [ ] Collapse state persists across Manager reload (same session)
- [ ] Collapse state doesn't leak between users/sessions
- [ ] No performance degradation with large number of tabs (50+)
- [ ] Console has no errors or warnings
- [ ] Manual test: Create Quick Tabs in 3 tabs → Manager groups them → Collapse
      middle group → Restore page → State persists </acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #1: Grouping Logic Details</summary>

JavaScript `Object.groupBy()` (ES2024) and `Array.prototype.group()` are ideal
but require polyfill for older environments. Fallback approach using `reduce()`:

The grouping function receives a flat array of Quick Tabs and returns an
object/Map where keys are originTabId values and values are arrays of Quick Tabs
belonging to that tab. Example:

```
Input: [
  {id: 'qt-42-1', originTabId: 42, ...},
  {id: 'qt-14-1', originTabId: 14, ...},
  {id: 'qt-42-2', originTabId: 42, ...}
]

Output: {
  42: [{id: 'qt-42-1', ...}, {id: 'qt-42-2', ...}],
  14: [{id: 'qt-14-1', ...}]
}
```

Within each group, sort so that active tabs (minimized === false) appear before
minimized tabs.

For Quick Tabs with null/undefined originTabId (from Issue #1 in the restoration
document), attempt to extract tab ID from the Quick Tab ID pattern. The pattern
is `qt-{tabId}-{timestamp}-{random}`. Extract the numeric tab ID using
`/^qt-(\d+)-/` regex. If extraction fails, assign to a special "unknown" group
or skip the tab.

</details>

<details>
<summary>Issue #2: Browser Tab Metadata Lookup Details</summary>

The `browser.tabs.query({})` API returns an array of all open tabs in the
current window. Each tab has properties:

- id (number) - unique tab ID
- title (string) - tab title
- url (string) - current page URL

When rendering group headers, combine title and domain from URL:
`"${title} - ${new URL(url).hostname} (Tab ${id})"` or simpler
`"${title} (Tab ${id})"` if domain is redundant.

Caching strategy: Store lookup result in a Map immediately after querying. When
rendering a group, check if tab ID exists in cache. If not, the tab has been
closed - show "Unknown Tab (Tab {id}) [Closed]" or similar fallback.

For improved UX, could implement cache invalidation by listening to
`browser.tabs.onRemoved(tabId, ...)` and
`browser.tabs.onUpdated(tabId, changeInfo, tab)` events. However, this requires
background script coordination. Simpler approach: On each `renderUI()` call,
validate tab IDs against current browser state - this is relatively cheap for
typical tab counts.

</details>

<details>
<summary>Issue #3: SessionStorage vs. LocalStorage Consideration</summary>

Collapse state should use `sessionStorage` (survives page reload, cleared on tab
close) rather than `browser.storage.local` (survives indefinitely). Rationale:

- Collapse state is primarily a UI preference, not important data
- User likely doesn't expect collapse state to survive a full browser restart
- sessionStorage is simpler (no async, no permissions)
- Reduces writes to browser storage API

Key format: `manager_tab_groups_collapse_state` as JSON object Value:
`{"42": true, "14": false}` (tab ID → expanded boolean)

Initialize on DOMContentLoaded:

```
const stored = sessionStorage.getItem('manager_tab_groups_collapse_state') || '{}';
tabGroupCollapseState = new Map(Object.entries(JSON.parse(stored)));
```

On toggle event:

```
sessionStorage.setItem('manager_tab_groups_collapse_state', JSON.stringify(Object.fromEntries(tabGroupCollapseState)));
```

</details>

<details>
<summary>Issue #4: HTML5 Details Element Semantics</summary>

The `<details>` element is specifically designed for collapsible content. The
`<summary>` element inside provides the clickable header. Key properties:

- `<details open>` attribute controls initial state (open = expanded, omitted =
  collapsed)
- Clicking `<summary>` toggles the `open` attribute
- Built-in browser support for expand/collapse, no JavaScript needed for basic
  functionality
- Keyboard accessible by default (Enter/Space to toggle, Tab to navigate)
- Fires `toggle` event when state changes (`.addEventListener('toggle', ...))`)

Avoid:

- Putting interactive elements (buttons, links) directly inside `<summary>` -
  click events may conflict with toggle behavior
- Solution: Wrap interactive elements in event.stopPropagation() or put outside
  summary

The `<summary>` should contain text and inline elements (span, icon elements).
Action buttons (minimize, close, etc.) should remain after the `<summary>`
outside the group structure, or use event.stopPropagation() to prevent
accidental group toggles.

Actually, for this UI design, action buttons should remain inside the nested
Quick Tab items, not inside the summary. The summary should only contain the
group header (title, count, icon). The action buttons come with each tab item.

</details>

<details>
<summary>Issue #5: CSS Details Styling and Animation</summary>

Modern approach for `<details>` styling:

- Use CSS `transition` on `max-height` to animate opening/closing (not all
  properties animate, but height and overflow can)
- Use CSS `::marker` pseudo-element for the disclosure triangle (the > or v
  icon)
- Customize color and styling of arrow, summary text, content area

Example approach:

```css
details > summary {
  cursor: pointer;
  padding: 6px 12px;
  /* styling */
}

details[open] > summary {
  background:; /* slightly different color */
}

details-list {
  /* content padding/spacing */
  overflow: hidden;
  transition: max-height 0.3s ease;
}

details[open] > .details-list {
  max-height: 1000px; /* or calculated dynamically */
}
```

Fallback for browsers without details support (very old): The `<details>`
element degrades gracefully - on unsupporting browsers, it shows all content
expanded. Not a concern for modern Firefox/Chrome, but keep in mind.

</details>

<details>
<summary>Issue #6: Event Delegation and Toggle Event Limitations</summary>

The `toggle` event on `<details>` elements bubbles in most modern browsers, but
not universally. Event bubbling behavior:

- `click` event: Bubbles, use event delegation on parent
- `toggle` event: May not bubble consistently (varies by browser version)

Safest approach: Add individual `toggle` listeners to each `<details>` element
during rendering:

```javascript
const details = document.createElement('details');
// ... populate details ...
details.addEventListener('toggle', e => {
  const tabId = details.dataset.tabId;
  tabGroupCollapseState.set(tabId, details.open);
  // persist to sessionStorage
});
```

Alternatively, if event delegation is preferred:

```javascript
containersList.addEventListener(
  'toggle',
  e => {
    if (e.target.tagName === 'DETAILS') {
      const tabId = e.target.dataset.tabId;
      // ... handle toggle
    }
  },
  true
); // true = capture phase (more reliable than bubbling)
```

For browser tab closure detection, currently Manager doesn't need to listen to
browser tab events. The closure is detected reactively: when user closes a tab,
the originTabId no longer exists in browser tab list. On next renderUI() or
periodic check, orphaned Quick Tabs are identified and flagged. Implementation
can be as simple as validating tab IDs during rendering.

</details>

<details>
<summary>Issue #7: Render Logic Refactoring Strategy</summary>

Current renderUI() is about 70 lines (830-900). New version needs:

1. Group the data (5-10 lines)
2. Look up tab metadata (10-15 lines)
3. Merge collapse state (5 lines)
4. Iterate groups and render (20-30 lines)
5. Maintain stats and empty state handling (unchanged, 10 lines)

Suggested refactoring:

- Extract `groupQuickTabsByOriginTabId(quickTabs)` → returns Map or object
- Extract `enrichGroupsWithMetadata(groups)` → adds tab title/url from cache
- Extract `applyCollapseState(groups)` → merges sessionStorage collapse state
- Extract `renderTabGroup(tabId, groupData)` → creates and returns `<details>`
  DOM element
- Keep `renderUI()` as orchestrator calling above functions in sequence

The renderTabGroup function would:

1. Create `<details>` element with `data-tab-id` attribute
2. Create `<summary>` element with group header (icon, title, count)
3. Add toggle event listener to update collapse state
4. Create `<div class="quick-tabs-list">` container
5. Iterate Quick Tabs in group and append renderQuickTabItem() for each
6. Optionally sort: active tabs first, then minimized
7. Return the complete `<details>` element

This keeps each function focused and testable.

</details>

---

**Priority:** High (enhancement feature, not bug fix) | **Target:** Single
coordinated PR | **Estimated Complexity:** High | **Dependencies:** Issues #1-5
are independent, Issues #6-7 depend on UI structure from #4

**Implementation Order:**

1. Issue #1 (data grouping logic) - foundation for everything else
2. Issue #2 (tab metadata) - needed for group headers
3. Issue #3 (collapse state) - simple state management
4. Issue #4 (HTML structure) + Issue #5 (CSS) - parallel work, UI foundation
5. Issue #7 (render logic refactoring) - depends on all above
6. Issue #6 (event listeners) - final integration and interactivity
