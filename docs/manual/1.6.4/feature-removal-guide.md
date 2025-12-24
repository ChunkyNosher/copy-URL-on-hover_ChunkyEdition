# Removal Guide: Solo/Mute Functionality and Quick Tabs Persistence

## Executive Summary

This guide details all code artifacts that must be removed to:
1. **Eliminate Solo/Mute functionality** from Quick Tabs
2. **Remove cross-session persistence** that stores Quick Tabs across browser restarts

## Section 1: Solo/Mute Functionality Removal

### Overview

The Solo/Mute feature allows minimizing individual Quick Tabs with a "mute" button, keeping them hidden but restoring them when needed. This is implemented across multiple layers of the codebase.

### Files Containing Solo/Mute Code

#### 1. **src/features/quick-tabs/minimized-manager.js**
   - **Scope**: Contains the entire `MinimizedManager` class that manages minimized (muted) Quick Tab state
   - **What to remove**: The entire file should be deleted or completely gutted
   - **Core problems with this file**:
     - Maintains `minimizedTabs` Map that tracks muted tabs
     - Manages snapshot lifecycle for position/size when tabs are muted
     - Handles restore operations that unhide muted tabs
     - Includes adoption lock mechanism for muted tab ownership tracking
     - Contains snapshot validation and persistence logic specific to minimize/restore

#### 2. **src/features/quick-tabs/handlers/VisibilityHandler.js**
   - **Scope**: Handles visibility state changes for Quick Tabs (minimize/restore operations)
   - **What to remove**: 
     - All methods related to minimizing Quick Tabs
     - All methods related to restoring minimized Quick Tabs  
     - All references to `MinimizedManager` class
     - All toggle/mute button event handlers
     - State validation logic for minimized vs visible state
   - **Key methods/functions to search for and remove**:
     - Any `minimize()` or `toggleMinimized()` methods
     - Any `restore()` or `unminimize()` methods
     - Any "MINIMIZE_" or "RESTORE_" message handlers
     - Event listeners for mute/solo buttons
     - Snapshot-related operations

#### 3. **src/features/quick-tabs/window.js**
   - **Scope**: Represents individual Quick Tab windows with all their properties and methods
   - **What to remove**:
     - `minimized` property from the Quick Tab object
     - `muted` property if it exists
     - Any getter/setter methods for minimized state
     - Methods that trigger minimize/restore operations
     - UI element creation for mute/solo buttons
     - All visibility-related CSS classes or styling logic

#### 4. **src/features/quick-tabs/index.js**
   - **Scope**: Main orchestrator for Quick Tabs feature
   - **What to remove**:
     - Initialization of `MinimizedManager` instance
     - All references to the minimized manager throughout the file
     - Message handler registration for minimize/restore operations
     - Storage persistence of minimized state
     - Hydration logic that restores minimized state on page load

#### 5. **src/content.js**
   - **Scope**: Content script that runs on every page
   - **What to remove**:
     - Any UI elements (buttons, icons) for minimizing Quick Tabs
     - Event listeners on mute/minimize buttons
     - CSS styling for minimized Quick Tab indicators (e.g., yellow highlight/badge)
     - Message sending for minimize/restore operations
     - Rendering logic that hides/shows minimized tabs

#### 6. **src/features/quick-tabs/mediator.js**
   - **Scope**: Coordinates between different Quick Tabs components
   - **What to remove**:
     - Any methods that delegate to `MinimizedManager`
     - Event routing for minimize/restore operations
     - State change handlers for minimized state transitions

#### 7. **src/features/quick-tabs/managers/** directory
   - **Scope**: Likely contains manager classes coordinating Quick Tabs behavior
   - **What to remove**:
     - Any file that imports or uses `MinimizedManager`
     - Any manager methods related to minimized state
     - Adoption lock logic used during minimize/restore

#### 8. **Storage/Persistence files** (TBD based on codebase scan)
   - **Scope**: Files handling browser.storage.local operations
   - **What to remove**:
     - Serialization of minimized state to storage
     - Deserialization of minimized state during restore
     - Storage schema fields related to minimized/muted status

#### 9. **UI/Component files in src/ui/**
   - **Scope**: User interface components for Quick Tabs
   - **What to remove**:
     - Mute button component
     - Solo button component
     - Minimized state indicator UI
     - CSS styling for muted tabs visual treatment

---

## Section 2: Cross-Session Persistence Removal

### Overview

Quick Tabs are currently designed to persist across browser restarts and sessions. This involves storing Quick Tab state to `browser.storage.local` and restoring it when the browser reopens.

### Files Containing Persistence Code

#### 1. **src/storage/** directory (entire directory or key files)
   - **Scope**: Handles all browser.storage.local read/write operations
   - **What to remove**:
     - All calls to `browser.storage.local.set()` for persisting Quick Tabs
     - All calls to `browser.storage.local.get()` for loading Quick Tabs
     - Storage key definitions (e.g., `STORAGE_KEY_QUICK_TABS`)
     - Serialization/deserialization logic for Quick Tabs
     - Migration logic for storage schema updates
     - Cleanup/orphan tab removal logic

#### 2. **src/features/quick-tabs/index.js** (storage-related sections)
   - **Scope**: Initialization and lifecycle management
   - **What to remove**:
     - Call to `browser.storage.local.get()` on extension load
     - Hydration of Quick Tabs from persisted storage
     - Storage persistence callback registration
     - Storage change event listener (`browser.storage.onChanged`)
     - Any `loadFromStorage()` or `saveToStorage()` method calls

#### 3. **src/background/** handlers (all files in this directory)
   - **Scope**: Background script message handlers
   - **What to remove**:
     - `GET_QUICK_TABS_STATE` message handler (used during hydration)
     - `SET_QUICK_TABS_STATE` or similar persistence message handlers
     - Any storage write operations triggered by Quick Tab state changes
     - Storage cleanup operations on tab close
     - Handlers that serialize/persist Quick Tab data to storage

#### 4. **src/content.js** (hydration-related sections)
   - **Scope**: Content script initialization
   - **What to remove**:
     - Hydration logic that runs on page load
     - `GET_QUICK_TABS_STATE` message sending to background
     - Restoration of Quick Tabs from hydrated state
     - Storage event listeners for cross-tab synchronization
     - Retry logic for failed hydration attempts

#### 5. **Hydration-related files** (e.g., `hydrate-quick-tabs.js` if exists)
   - **Scope**: Dedicated hydration orchestration
   - **What to remove**:
     - Entire file (if it exists as a standalone module)
     - Or all functions within if integrated into index.js
     - Message sending for state retrieval
     - State application to DOM
     - Cross-tab/cross-container filtering logic
     - Retryable failure handling

#### 6. **TabLifecycleHandler.js**
   - **Scope**: Handles tab creation/removal/update events
   - **What to remove**:
     - Storage cleanup when tabs are closed (orphan removal)
     - Storage updates when tabs are created/destroyed
     - Persistence callbacks triggered on tab lifecycle events
     - Any migration or schema update logic on tab state changes

#### 7. **QuickTabHandler.js** (in src/background/handlers/)
   - **Scope**: Background handler for Quick Tab operations
   - **What to remove**:
     - Storage write after Quick Tab creation
     - Storage write after Quick Tab updates (position, size, etc.)
     - Storage write after Quick Tab deletion
     - Any coalescing/batching logic for storage writes
     - Rate-limiting logic for storage persistence

#### 8. **MessageRouter.js** (in src/background/)
   - **Scope**: Routes messages from content script to handlers
   - **What to remove**:
     - Message routing for GET_QUICK_TABS_STATE (hydration)
     - Message routing for state persistence messages
     - Storage-related message type definitions

#### 9. **Schema/Configuration files**
   - **Scope**: Define storage keys and data structures
   - **What to remove**:
     - Storage key constants (e.g., `QUICK_TABS_STORAGE_KEY`)
     - Data schema definitions for persisted Quick Tab objects
     - Version numbers for schema migrations
     - Any type definitions for serialized state

#### 10. **Test/Debug files** (if exists)
   - **Scope**: Test utilities that verify persistence
   - **What to remove**:
     - Test cases for storage read/write
     - Mock storage implementations
     - Debug utilities for inspecting stored state

---

## Section 3: Implementation Strategy

### Phase 1: Remove Minimize/Mute Functionality
1. Delete `src/features/quick-tabs/minimized-manager.js` entirely
2. In `VisibilityHandler.js`: Remove all minimize/restore related methods and logic
3. In `window.js`: Remove `minimized` property and mute button element creation
4. In `index.js`: Remove `MinimizedManager` instantiation and usage
5. In `content.js`: Remove mute button event listeners and UI rendering
6. In UI component files: Remove mute/solo button components and styling
7. Search entire codebase for remaining references to "minimized", "mute", "solo", "restore" state operations and remove

### Phase 2: Remove Cross-Session Persistence
1. In `content.js`: Remove `GET_QUICK_TABS_STATE` message sending and hydration flow
2. In `index.js`: Remove `browser.storage.local.get()` calls and hydration initialization
3. In `background/handlers/`: Remove storage write operations from all handlers
4. In `storage/` directory: Remove or disable all browser.storage.local operations
5. In `TabLifecycleHandler.js`: Remove storage cleanup on tab close
6. In `MessageRouter.js`: Remove routing for hydration/persistence messages
7. Search entire codebase for:
   - `browser.storage.local.set()`
   - `browser.storage.local.get()`
   - `browser.storage.onChanged`
   - Storage key constants
   - "hydration", "persistence", "restore" related to storage
8. Remove all identified references

### Phase 3: Cleanup and Validation
1. Remove any import statements for deleted files
2. Remove empty directories left after file deletions
3. Search for orphaned event listeners related to removed features
4. Remove CSS classes that styled minimized/persisted Quick Tabs
5. Test that remaining Quick Tabs functionality works without persistence:
   - Create Quick Tab
   - Update Quick Tab (move, resize)
   - Delete Quick Tab
   - Verify Quick Tabs disappear on page navigation
   - Verify Quick Tabs don't reappear after browser restart

---

## Section 4: Search Patterns for Comprehensive Removal

Use these search patterns to identify all relevant code:

### For Minimize/Mute Feature:
- `minimize`
- `minimized`
- `restore` (in context of visibility)
- `mute`
- `muted`
- `solo`
- `MinimizedManager`
- `VisibilityHandler`
- `mute button`
- `minimize button`

### For Persistence Feature:
- `browser.storage.local.set`
- `browser.storage.local.get`
- `browser.storage.onChanged`
- `hydration`
- `hydrate`
- `GET_QUICK_TABS_STATE`
- `SET_QUICK_TABS_STATE`
- `persistence`
- `STORAGE_KEY`
- `loadFromStorage`
- `saveToStorage`
- `restore` (in context of browser restart)

---

## Section 5: References to Existing Diagnostic Documents

For additional context on why these features introduce complexity, refer to:
- `docs/manual/1.6.3/quick-tabs-minimize-restore-bugs-diagnosis.md` - Contains detailed analysis of minimize/restore race conditions
- `docs/manual/1.6.3/quick-tabs-sync-removal-guide.md` - Contains guidance on removing related sync features
- `docs/manual/1.6.4/quicktabs-restore-duplicate-window-diagnostic.md` - Documents restoration bugs

These diagnostic documents demonstrate that the minimize/restore and persistence features have been a significant source of bugs and architectural complexity throughout the codebase versions.

---

## Acceptance Criteria

After removal, verify:
- [ ] No imports of `MinimizedManager` remain
- [ ] No message handlers for `GET_QUICK_TABS_STATE` or persistence messages
- [ ] No `browser.storage.local.set()` calls for Quick Tabs state
- [ ] No hydration logic in content script
- [ ] No mute/minimize UI buttons in Quick Tabs
- [ ] Quick Tabs are created only in the current session
- [ ] Quick Tabs disappear when the page is closed/navigated
- [ ] Quick Tabs do NOT reappear after browser restart
- [ ] No minimized state tracking anywhere in codebase
- [ ] Quick Tabs functionality remains for single-session use

