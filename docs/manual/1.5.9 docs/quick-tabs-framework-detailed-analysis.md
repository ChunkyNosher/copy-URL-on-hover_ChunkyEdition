# Detailed Framework Changes for Quick Tabs Zen Split View Integration

**Date:** November 17, 2025  
**Purpose:** Deep-dive into framework-level changes required for context-aware Quick Tab behavior in Zen Browser Split View

---

## Executive Summary

To implement the requested Quick Tab behaviors in Zen Browser's Split View, the copy-URL-on-hover extension requires fundamental changes across six major framework areas:

1. **Context Detection & Identification System** (NEW)
2. **State Management Architecture** (MAJOR REFACTOR)
3. **Event Coordination & Focus Tracking** (NEW)
4. **DOM Injection & Rendering Strategy** (MAJOR REFACTOR)
5. **Position & Layout Management** (MODERATE REFACTOR)
6. **Storage & Persistence Layer** (MODERATE REFACTOR)

This document details what needs to change in each area without prescribing specific code implementations.

---

## 1. Context Detection & Identification System (NEW COMPONENT)

### 1.1 What Currently Exists

The extension currently has:
- No awareness of Zen Browser's Split View state
- No concept of "panes" or "browser containers" beyond the single active tab
- Simple tab-level tracking via browser.tabs API
- Global scope assumptions (all Quick Tabs visible everywhere)

### 1.2 What Needs to Be Added

**A. Zen Split View Detector**
- A new subsystem that continuously monitors whether Zen's Split View is currently active
- Detection should trigger on:
  - Extension initialization
  - Tab switching events
  - Split view activation/deactivation
  - Browser window focus changes
- Must distinguish between three states:
  1. Standard single-tab mode (global scope)
  2. Zen Split View active (pane scope)
  3. Transitioning between modes

**B. Pane Identification Registry**
- A registry that maps each visible browser container/pane to a unique, stable identifier
- Must track:
  - Current pane/container ID
  - Parent split session ID
  - Pane position within split layout (optional for now, but useful)
  - Whether pane is currently focused/active
- Registry must update dynamically as:
  - Panes are added/removed from split view
  - User switches focus between panes
  - Split layout changes (2-split → 4-split, etc.)

**C. Active Context Tracker**
- A component that always knows the "current context" the user is in:
  - If in global tab mode: returns "global" scope identifier
  - If in split view: returns specific pane ID
- Must provide immediate answers to queries like:
  - "What context am I in right now?"
  - "What panes exist in the current split session?"
  - "Which pane currently has focus?"

**D. Context Change Event Emitter**
- An event emitter that broadcasts notifications when context changes:
  - `contextEntered` - User entered a new context (tab/pane)
  - `contextExited` - User left a context
  - `splitViewActivated` - Split view became active
  - `splitViewDeactivated` - Split view was closed
  - `paneCreated` / `paneDestroyed` - Panes added/removed
  - `focusChanged` - Active pane changed within split view

### 1.3 Integration Points

This new system must integrate with:
- **QuickTabsManager**: To know which context Quick Tabs belong to
- **PanelManager**: To track manager position per-context
- **Event Bus**: To broadcast context changes to all features
- **Storage Layer**: To persist context associations
- **DOM Utilities**: To query Zen's split view DOM elements

### 1.4 Fallback Requirements

- Must gracefully degrade on non-Zen browsers (always return "global" context)
- Must handle Zen API changes (fallback to DOM inspection)
- Must recover from missing/invalid context data (default to global scope)

---

## 2. State Management Architecture (MAJOR REFACTOR)

### 2.1 What Currently Exists

Current state management (from `state-manager.js` and QuickTabsManager):
- **Global window registry**: Map of Quick Tab window IDs → window instances
- **Flat storage model**: All Quick Tabs stored in single array/object
- **Tab-level scoping**: State keyed by browser tab ID only
- **No context differentiation**: Cannot distinguish between global vs. pane scope

### 2.2 What Needs to Change

**A. Hierarchical State Model**

Replace flat state with hierarchical structure:

**Top Level: Scope Type**
- Global Scope (for standalone tabs)
- Split View Scope (for split sessions)

**Second Level: Context ID**
- For global: Single shared context
- For split view: Per-pane context keys

**Third Level: Quick Tab Instances**
- Individual Quick Tab windows within each context
- Quick Tab Manager instance per-context

**State Tree Structure:**
```
State
├── Global Context
│   ├── Quick Tabs: [QT1, QT2, ...]
│   └── Manager: { position, visibility, ... }
└── Split View Contexts
    ├── Pane-1-1
    │   ├── Quick Tabs: [QT3, QT4, ...]
    │   └── Manager: { position, visibility, ... }
    ├── Pane-1-2
    │   ├── Quick Tabs: [QT5, ...]
    │   └── Manager: { position, visibility, ... }
    └── ...
```

**B. Context-Aware State Operations**

All state operations must become context-aware:

**Create Operations:**
- Accept `contextId` parameter
- Store Quick Tab under correct context key
- Validate context exists before creation

**Read Operations:**
- Accept `contextId` parameter (or use current active context)
- Return only Quick Tabs belonging to that context
- Filter out Quick Tabs from other contexts

**Update Operations:**
- Validate Quick Tab belongs to context before updating
- Prevent cross-context state pollution

**Delete Operations:**
- Remove Quick Tab from specific context only
- Clean up context if no Quick Tabs remain

**C. Context Lifecycle Management**

State manager must handle context lifecycle:

**Context Creation:**
- Initialize empty state structure when new pane detected
- Inherit manager position from parent context (if applicable)

**Context Activation:**
- Mark context as "active"
- Trigger visibility updates for Quick Tabs and manager

**Context Deactivation:**
- Mark context as "inactive"
- Hide Quick Tabs and manager for this context

**Context Destruction:**
- Save any persistent Quick Tabs to storage
- Remove context from active state tree
- Clean up DOM references

**D. State Synchronization Rules**

Define clear rules for when state syncs between contexts:

**Global → Split Transition:**
- Global Quick Tabs become invisible (but remain in memory)
- Quick Tabs don't transfer to split panes
- Manager position transfers to first active pane

**Split → Global Transition:**
- Pane-scoped Quick Tabs remain in their pane contexts
- Global Quick Tabs become visible again
- Manager position transfers back to global scope

**Pane Focus Changes:**
- Manager toggles visibility between panes
- Quick Tabs in unfocused panes remain hidden but alive

### 2.3 Migration Requirements

**Backward Compatibility:**
- Must load old flat state format
- Migrate to hierarchical format on first load
- Preserve all existing Quick Tabs during migration

**Data Integrity:**
- Validate context references before accessing
- Handle orphaned Quick Tabs (context no longer exists)
- Prevent duplicate Quick Tabs across contexts

---

## 3. Event Coordination & Focus Tracking (NEW COMPONENT)

### 3.1 What Currently Exists

Current event handling:
- **Keyboard listeners**: Global document-level event listeners
- **Tab events**: Basic browser.tabs.onActivated
- **Storage events**: browser.storage.onChanged
- **BroadcastChannel**: Cross-tab messaging for Quick Tab sync

### 3.2 What Needs to Be Added

**A. Focus Tracking System**

A new system that continuously tracks user focus:

**Document Focus:**
- Which browser document currently has focus
- When focus enters/exits iframes (Quick Tabs themselves)
- Keyboard focus vs. mouse focus distinction

**Pane Focus (Zen Split View):**
- Which split view pane is currently active
- Focus changes between panes within same split session
- Focus changes when clicking into different panes

**Tab Focus:**
- Which browser tab is active (existing)
- Tab switches that cross context boundaries
- Tab switches within same context

**B. Zen Split View Event Listeners**

New event listeners specifically for Zen:

**DOM Mutation Observers:**
- Watch for `zen-split-view` attribute changes
- Watch for `.browserSidebarContainer` additions/removals
- Watch for z-index changes (indicates focus change)
- Watch for `deck-selected` class changes

**Pointer Events:**
- Track mousedown/pointerdown on panes
- Detect user clicking into different panes
- Capture pane boundaries for hit testing

**Keyboard Events:**
- Detect Zen keyboard shortcuts (Ctrl+Alt+V, etc.)
- Intercept split view activation/deactivation
- Track focus changes from keyboard navigation

**C. Event Coordination Bus**

Enhanced event bus to coordinate all event types:

**Event Priority System:**
- High priority: Context changes (must process first)
- Medium priority: Focus changes
- Low priority: UI updates

**Event Batching:**
- Group rapid-fire events (e.g., multiple pane focus changes)
- Debounce/throttle to prevent event storms
- Process batched events efficiently

**Event Routing:**
- Route events to correct context handlers
- Prevent global handlers from interfering with pane handlers
- Allow context-specific event overrides

**D. Focus State Machine**

A state machine that tracks focus transitions:

**States:**
- `GlobalFocus` - User in standard tab
- `SplitPaneFocus(paneId)` - User in specific split pane
- `ManagerFocus` - User interacting with Quick Tab Manager
- `QuickTabFocus(qtId)` - User clicked inside a Quick Tab iframe
- `Transitioning` - Between states

**Transitions:**
- Define valid transitions (e.g., `GlobalFocus → SplitPaneFocus`)
- Invalid transitions trigger fallback behavior
- Each transition emits events for state updates

**State Actions:**
- Entry actions: Execute when entering state
- Exit actions: Execute when leaving state
- Stay actions: Continuous while in state

### 3.3 Integration Requirements

**Quick Tab Rendering:**
- Subscribe to focus events
- Show/hide based on context focus
- Update z-index based on focus state

**Quick Tab Manager:**
- Subscribe to pane focus changes
- Toggle visibility on focus transitions
- Preserve position across focus changes

**Keyboard Handlers:**
- Check focus state before processing shortcuts
- Route shortcuts to correct context
- Prevent shortcuts in unfocused contexts

---

## 4. DOM Injection & Rendering Strategy (MAJOR REFACTOR)

### 4.1 What Currently Exists

Current DOM injection (from `window.js`):
- **Global injection**: `document.body.appendChild(container)`
- **Fixed positioning**: `position: fixed` relative to viewport
- **No container awareness**: Injected elements assume single viewport
- **Z-index management**: Simple incrementing z-index system

### 4.2 What Needs to Change

**A. Context-Aware Injection Targets**

Replace global `document.body` injection with context-aware targeting:

**For Global Context:**
- Continue injecting into `document.body`
- Use `position: fixed` (viewport-relative)
- Quick Tabs visible across all global tabs

**For Split View Panes:**
- Inject into specific `.browserSidebarContainer` element
- Use `position: absolute` (container-relative)
- Quick Tabs constrained to pane boundaries

**Injection Target Selection:**
- Query context system for current context
- If global: use `document.body`
- If pane: find and use specific container element
- Cache injection targets for performance

**B. Positioning Strategy Overhaul**

Different positioning for different contexts:

**Global Context Positioning:**
- Maintain existing `position: fixed` approach
- Coordinates relative to browser window viewport
- Works across tab switches (within global scope)

**Pane Context Positioning:**
- Switch to `position: absolute`
- Coordinates relative to parent `.browserSidebarContainer`
- Calculate container offset when positioning
- Clamp Quick Tab bounds to container dimensions

**Position Translation Logic:**
- Convert between coordinate systems when switching contexts
- Global (viewport-relative) ↔ Pane (container-relative)
- Account for container position/size in calculations
- Preserve visual position across context switches

**C. Visibility Control Mechanism**

Explicit visibility management beyond just existence:

**Rendering States:**
- `Rendered & Visible` - Normal display state
- `Rendered & Hidden` - In DOM but `display: none`
- `Not Rendered` - Removed from DOM entirely

**Visibility Rules:**
- Quick Tabs in active context: `Rendered & Visible`
- Quick Tabs in inactive context (same scope): `Rendered & Hidden`
- Quick Tabs in different scope: `Not Rendered`

**Performance Optimization:**
- Lazy render Quick Tabs until context becomes active
- Cache rendered elements for fast show/hide
- Destroy elements if context hasn't been active for N minutes

**D. Z-Index Coordination**

Integrate with Zen's z-index system:

**Zen Split View Z-Index:**
- Each pane has its own z-index (managed by Zen)
- Active pane has highest z-index
- Quick Tabs must layer above their parent pane

**Quick Tab Z-Index:**
- Base z-index: `pane.zIndex + offset`
- Manager z-index: `pane.zIndex + offset + 1000`
- Within-context z-index: Relative ordering preserved

**Z-Index Updates:**
- Listen for Zen's pane z-index changes
- Recalculate Quick Tab z-indexes accordingly
- Ensure manager always floats above Quick Tabs

**E. Rendering Lifecycle Hooks**

Add lifecycle hooks for context-aware rendering:

**Pre-Render:**
- Validate context exists
- Determine injection target
- Calculate initial position

**Render:**
- Create DOM elements
- Inject into target
- Apply styles and positioning

**Post-Render:**
- Register with context
- Subscribe to context events
- Start visibility tracking

**Pre-Hide:**
- Save current state
- Unsubscribe from some events

**Hide:**
- Set `display: none` or remove from DOM
- Preserve state in memory

**Pre-Show:**
- Validate context still exists
- Resubscribe to events

**Show:**
- Restore to DOM if needed
- Apply saved position/state
- Update visibility

**Destroy:**
- Remove from DOM
- Unregister from context
- Clean up event listeners

### 4.3 Container Management

**Container Discovery:**
- Query selector strategies to find Zen containers
- Fallback chain if primary selectors fail
- Validate container is actually a split pane

**Container Tracking:**
- Monitor container lifecycle (creation/destruction)
- Track container dimensions and position
- Detect container layout changes

**Container Validation:**
- Verify container exists before injection
- Check container is visible and active
- Handle container removal gracefully

---

## 5. Position & Layout Management (MODERATE REFACTOR)

### 5.1 What Currently Exists

Current position management:
- **Absolute coordinates**: `left`, `top` values in pixels
- **Viewport-relative**: All positions relative to browser window
- **Simple clamping**: Basic bounds checking for window edges
- **No context awareness**: Same position system everywhere

### 5.2 What Needs to Change

**A. Multi-Coordinate System Support**

Support two coordinate systems simultaneously:

**Viewport Coordinates (Global Context):**
- Traditional `(x, y)` relative to browser window
- Used when in standard tab mode
- Maintains compatibility with existing logic

**Container Coordinates (Pane Context):**
- `(x, y)` relative to parent `.browserSidebarContainer`
- Used when in split view panes
- Requires offset calculations

**Coordinate Translation:**
- Convert viewport → container on context switch
- Convert container → viewport on reverse switch
- Account for container position, size, scroll state

**B. Relative Position Preservation**

Preserve "relative position" across contexts:

**Concept:**
- Store position as percentage of container dimensions
- Example: "top-right corner" = `(90%, 10%)`
- When context changes, recalculate absolute position

**Storage Format:**
- Absolute: `{ left: 500, top: 200 }` (pixels)
- Relative: `{ leftPercent: 50, topPercent: 25 }` (percent)
- Store both for flexibility

**Recalculation Logic:**
- On context change, fetch new container dimensions
- Apply percentages to get new absolute position
- Clamp to new container bounds

**C. Bounds Checking Enhancements**

Smarter bounds checking per context:

**Global Context Bounds:**
- Clamp to `window.innerWidth` and `window.innerHeight`
- Account for browser chrome (toolbars, etc.)
- Prevent Quick Tabs from going off-screen

**Pane Context Bounds:**
- Clamp to container's `clientWidth` and `clientHeight`
- Subtract container padding/borders
- Ensure Quick Tab never exceeds pane boundaries

**Dynamic Bounds:**
- Recalculate bounds when:
  - Container resizes
  - Window resizes
  - Browser zoom changes
  - Split layout changes

**D. Manager Position Synchronization**

Special handling for Quick Tab Manager position:

**Position Memory:**
- Remember last position in each context
- When returning to context, restore saved position
- Maintain separate memory for global vs. each pane

**Position Transfer:**
- On context switch, calculate relative position in old context
- Apply relative position to new context dimensions
- Example: Manager at top-right in pane → top-right in global tab

**Persistence:**
- Save manager position per-context to storage
- Restore positions on browser restart
- Handle missing positions (default to safe location)

**E. Layout Adaptation**

Adapt Quick Tab layouts to container constraints:

**Size Constraints:**
- Quick Tabs in small panes: Reduce min-width/min-height
- Quick Tabs in large panes: Allow larger dimensions
- Respect pane aspect ratio when resizing

**Stacking Behavior:**
- In narrow panes: Stack Quick Tabs vertically
- In wide panes: Allow side-by-side Quick Tabs
- Auto-adjust on pane resize

---

## 6. Storage & Persistence Layer (MODERATE REFACTOR)

### 6.1 What Currently Exists

Current storage (from QuickTabsManager):
- **browser.storage.sync**: Cross-device Quick Tab state
- **browser.storage.session**: Ephemeral state (Firefox 115+)
- **browser.storage.local**: Manager position
- **Flat structure**: Single object per storage type
- **Container awareness**: Some Firefox Container support

### 6.2 What Needs to Change

**A. Hierarchical Storage Schema**

Redesign storage schema for context hierarchy:

**Top-Level Keys:**
- `quickTabs_global` - Global scope Quick Tabs
- `quickTabs_splitPanes` - Split pane contexts
- `quickTabManager_positions` - Manager position per context
- `contextMetadata` - Context lifecycle data

**Nested Structure Example:**
```
quickTabs_splitPanes: {
  "pane-1-1": {
    windows: [...],
    lastActive: timestamp,
    parentSplit: "split-session-1"
  },
  "pane-1-2": {
    windows: [...],
    lastActive: timestamp,
    parentSplit: "split-session-1"
  }
}
```

**B. Context-Scoped Save/Load**

All storage operations become context-aware:

**Save Operations:**
- Accept context ID parameter
- Update only the relevant context's data
- Don't overwrite other contexts
- Use atomic writes to prevent race conditions

**Load Operations:**
- Fetch all contexts
- Filter by current context if specified
- Lazy-load inactive contexts
- Cache frequently accessed contexts

**Incremental Updates:**
- Update single Quick Tab without rewriting entire context
- Delta-based storage to reduce write overhead
- Conflict resolution for concurrent updates

**C. Context Lifecycle Persistence**

Track context metadata:

**Context Birth/Death:**
- Record when context first created
- Track last active timestamp
- Mark contexts as "stale" after N days
- Clean up stale contexts automatically

**Context Relationships:**
- Track parent split session
- Track sibling panes in same split
- Maintain context family tree

**Context Migration:**
- Handle context ID changes (Zen updates)
- Migrate orphaned Quick Tabs to new contexts
- Recover from corrupted context data

**D. Position Persistence Strategy**

Specialized storage for positions:

**Per-Context Position Storage:**
```
quickTabManager_positions: {
  "global": { left: 500, top: 200, leftPercent: 50, topPercent: 25 },
  "pane-1-1": { left: 100, top: 50, leftPercent: 10, topPercent: 5 },
  "pane-1-2": { left: 100, top: 50, leftPercent: 10, topPercent: 5 }
}
```

**Fallback Chain:**
- Try loading position for exact context ID
- Fall back to parent split session position
- Fall back to global position
- Fall back to default position

**Position Staleness:**
- Track when position was last updated
- Invalidate positions older than N days
- Recalculate positions if container dimensions changed significantly

**E. Cross-Context Sync Strategy**

Coordinate sync between contexts:

**BroadcastChannel Updates:**
- Broadcast context-specific updates only
- Include context ID in all messages
- Subscribers filter by relevant context

**Storage Event Handling:**
- Detect changes from other tabs/windows
- Update only affected contexts
- Prevent full state reload on every change

**Conflict Resolution:**
- Last-write-wins for same context
- Independent updates for different contexts
- Merge strategy for concurrent global updates

**F. Migration and Versioning**

Handle schema changes over time:

**Version Tracking:**
- Store schema version in storage
- Detect version mismatches on load
- Trigger migration routines

**Migration Pipeline:**
- v1 (flat) → v2 (hierarchical)
- Preserve all user data during migration
- Validate migrated data
- Rollback on migration failure

**Backward Compatibility:**
- Support reading old formats
- Always write in new format
- Never corrupt old data

---

## 7. Cross-Cutting Framework Concerns

### 7.1 Error Handling & Recovery

**Context Not Found:**
- Graceful degradation to global context
- Log warning for debugging
- Attempt context reconstruction

**DOM Element Missing:**
- Retry with backoff
- Fall back to document.body
- Notify user if persistent

**Storage Corruption:**
- Validate all loaded data
- Discard invalid contexts
- Rebuild from minimal valid state

### 7.2 Performance Optimization

**Lazy Loading:**
- Don't render Quick Tabs for inactive contexts
- Defer heavy operations until context active
- Cache rendering results

**Debouncing:**
- Batch context change events
- Throttle storage writes
- Delay non-critical updates

**Memory Management:**
- Limit number of cached contexts
- Unload stale contexts
- Release DOM references when hidden

### 7.3 Testing & Debugging

**Context Inspection:**
- Add debug mode to visualize contexts
- Show context tree in developer tools
- Log context transitions

**State Validation:**
- Verify state consistency on every operation
- Assert context references are valid
- Check for orphaned Quick Tabs

**Simulation:**
- Mock Zen Split View for testing
- Simulate context switches
- Test all transition paths

### 7.4 Documentation & Logging

**Context Logging:**
- Log every context creation/destruction
- Log all context switches with timestamps
- Track Quick Tab associations with contexts

**Performance Metrics:**
- Measure context switch latency
- Track rendering performance per context
- Monitor storage operation times

---

## 8. Summary of Major Framework Areas

| Framework Area | Change Magnitude | Key Additions/Changes |
|----------------|------------------|----------------------|
| **Context Detection** | NEW | Zen detector, pane registry, focus tracker, event emitter |
| **State Management** | MAJOR REFACTOR | Hierarchical state tree, context-aware operations, lifecycle management |
| **Event Coordination** | NEW | Focus tracking system, Zen event listeners, state machine, coordination bus |
| **DOM Injection** | MAJOR REFACTOR | Context-aware targets, dual positioning strategies, visibility control, z-index coordination |
| **Position Management** | MODERATE REFACTOR | Multi-coordinate systems, relative preservation, smart bounds checking, manager sync |
| **Storage Layer** | MODERATE REFACTOR | Hierarchical schema, context-scoped operations, metadata tracking, migration pipeline |

---

## 9. Implementation Priorities

**Phase 1: Foundation (Weeks 1-2)**
- Context Detection & Identification System
- Basic context registry
- Zen Split View detection

**Phase 2: State Refactor (Weeks 3-4)**
- Hierarchical state model
- Context-aware state operations
- Context lifecycle management

**Phase 3: Event & Focus (Weeks 5-6)**
- Focus tracking system
- Zen event listeners
- Focus state machine

**Phase 4: Rendering (Weeks 7-9)**
- Context-aware injection
- Dual positioning strategies
- Visibility control

**Phase 5: Position & Storage (Weeks 10-11)**
- Relative position preservation
- Hierarchical storage schema
- Migration system

**Phase 6: Testing & Polish (Weeks 12-13)**
- Comprehensive testing
- Performance optimization
- Bug fixes and edge cases

---

## 10. Risk Mitigation

**Zen API Instability:**
- Build abstraction layer over Zen internals
- Support multiple detection methods
- Version detection with fallbacks

**Scope Creep:**
- Implement minimal viable features first
- Add enhancements incrementally
- Feature-flag experimental capabilities

**User Experience:**
- Maintain legacy behavior by default
- Gradual rollout with opt-in
- Clear documentation and tutorials

**Technical Debt:**
- Refactor incrementally, not all at once
- Maintain backward compatibility
- Write extensive tests before refactoring

---

## Conclusion

Implementing the requested Quick Tab behaviors requires transforming the extension from a global-scope system into a context-aware, multi-scope architecture. The six major framework areas—Context Detection, State Management, Event Coordination, DOM Injection, Position Management, and Storage—all need significant changes to support the hierarchical scoping and visibility rules you described.

The key architectural shift is moving from "one Quick Tab state for everything" to "separate Quick Tab state per context," with intelligent coordination to make context switches seamless for the user. This requires new infrastructure (context detection, focus tracking) and fundamental refactoring of existing systems (state management, DOM rendering), but preserves all existing functionality for non-Zen browsers and standard tab usage.

---

**Document Version:** 1.0  
**Last Updated:** November 17, 2025  
**Author:** AI Technical Analysis (via ChunkyNosher request)