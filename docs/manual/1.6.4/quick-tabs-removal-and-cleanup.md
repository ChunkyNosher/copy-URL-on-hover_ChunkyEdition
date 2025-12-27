# Quick Tabs: Complete Removal of Solo/Mute, Persistence, and Version-Based Log Cleanup

**Repository:** copy-URL-on-hover_ChunkyEdition  
**Date:** 2025-12-25  
**Objective:** Comprehensively remove Solo/Mute functionality, eliminate Quick
Tabs persistence across browser restarts, and implement automatic log history
clearing on version updates.

---

## 1. Solo/Mute Functionality – Complete Removal

### 1.1 Functional Scope

The Solo (🎯) and Mute (🔇) features are currently integrated throughout the
Quick Tabs system as mutually exclusive states per tab. These need to be
completely removed:

- **Solo state**: Enforces a single active Quick Tab per container, forcing
  others to be hidden.
- **Mute state**: Hides a Quick Tab without making others visible (independent
  suppression).
- **UI controls**: Solo/Mute buttons are present in the Quick Tabs toolbar.
- **State persistence**: Solo/Mute states are stored in `browser.storage.local`
  and restored on browser restart.
- **State machine transitions**: The state machine has explicit handling for
  solo/mute toggle events and mutual exclusivity rules.

### 1.2 Key Files Containing Solo/Mute References

The following files must be scanned and cleaned to remove all Solo/Mute traces:

**Core Logic & State Management:**

- `src/features/quick-tabs/state-machine.js` — Contains solo/mute transition
  handlers, mutual exclusivity logic, and state flags like `isSolo`, `isMuted`
- `src/features/quick-tabs/mediator.js` — Routes solo/mute toggle events,
  applies transitions, persists state
- `src/features/quick-tabs/index.js` — Orchestrates quick-tabs initialization;
  may listen for or dispatch solo/mute events
- `src/features/quick-tabs/managers/*` — Manager modules may have
  solo/mute-specific operations (e.g., disabling/enabling buttons based on
  state)

**Persistence & Storage:**

- `src/storage/SyncStorageAdapter.js` — Reads/writes quick-tab solo/mute flags
  to `browser.storage.local`
- Any migration or versioning code that handles solo/mute state from previous
  versions

**UI / Toolbar:**

- Quick Tabs toolbar HTML/templates — Solo/Mute buttons and their labels
- Quick Tabs toolbar JavaScript event handlers — Click handlers for solo/mute
  toggles
- Manager sidebar HTML/templates — Any UI that displays or controls solo/mute
  state (e.g., solo/mute icons in minimized list)

**Background & Content Scripts:**

- `src/content.js` — May dispatch or listen for solo/mute-related messages
- `background.js` — May route solo/mute messages to managers or state handlers
- Test bridge handlers (`src/test-bridge*.js`) — Test methods for toggling
  solo/mute state

### 1.3 Specific Patterns to Remove

- **State flags**: Any field named `isSolo`, `isMuted`, `soloState`,
  `muteState`, `solo`, `muted`, or similar boolean/enum values
- **Transition events**: `SOLO_TOGGLED`, `MUTE_TOGGLED`, `SOLO_ACTIVATED`,
  `MUTE_ACTIVATED`, `SOLO_DEACTIVATED`, `MUTE_DEACTIVATED`, or similar event
  names
- **Storage keys**: Keys in `browser.storage.local` for storing solo/mute
  settings (e.g., `quickTabs_solo_*`, `quickTabs_mute_*`, or within the main
  quick-tabs object under `solo`/`muted` properties)
- **Button/UI elements**: HTML elements with IDs, classes, or data-attributes
  referencing solo/mute (e.g., `solo-btn`, `mute-btn`, `[data-action="solo"]`,
  `[data-action="mute"]`)
- **Event listeners**: Message listeners or click handlers bound to solo/mute
  buttons
- **Conditional logic**: If-statements or state checks that branch on solo/mute
  status (these should be removed or simplified)

---

## 2. Quick Tabs Persistence Removal

### 2.1 Design Principle

Quick Tabs were intended to be **temporary by design**. Their lifecycle should
match the browser session or tab's active period. Currently, the system persists
Quick Tabs state to `browser.storage.local` and restores it on browser restart.
This must be removed entirely.

### 2.2 Functional Scope

The following persistence behaviors must be eliminated:

- **Browser restart restoration**: On browser startup, the extension loads
  stored Quick Tabs and recreates them.
- **Cross-session state**: Quick Tabs minimized state, position, z-order, and
  configuration are retained across sessions.
- **Migration on upgrade**: If the extension version changes, stored Quick Tabs
  are migrated or recovered.
- **Storage keys**: Any storage keys dedicated to Quick Tabs state (e.g.,
  `quickTabs_list`, `quickTabs_byId`, `quickTabs_minimized`, `quickTabs_config`)

### 2.3 Key Files Containing Persistence Logic

**Storage & Migration:**

- `src/storage/SyncStorageAdapter.js` — Primary interface for reading/writing
  Quick Tabs to `browser.storage.local`; must be gutted of persistence calls for
  Quick Tabs
- Any migration handler files that perform version-based restoration (e.g.,
  `src/background/migration.js`, `src/storage/migration.js`, or similar)
- Initialization code in `background.js` or startup modules that invoke
  `SyncStorageAdapter.read()` for Quick Tabs

**Orchestration & Initialization:**

- `src/features/quick-tabs/index.js` — Likely contains logic to restore Quick
  Tabs from storage on initialization
- `src/features/quick-tabs/mediator.js` — May persist state after every toggle;
  should be modified to skip persistence entirely

**UI & Sidebar:**

- Manager/sidebar code that checks for persisted Quick Tabs and populates the
  minimized list UI

**Content & Background:**

- `background.js` — May have listener for extension startup that triggers
  restoration
- `src/content.js` — May validate or sync stored Quick Tabs with current page
  state

### 2.4 Specific Patterns to Remove

- **Storage writes**: Calls to `browser.storage.local.set()` or
  `SyncStorageAdapter.write()` where the data includes Quick Tabs
- **Storage reads**: Calls to `browser.storage.local.get()` or
  `SyncStorageAdapter.read()` that retrieve Quick Tabs on startup
- **Restoration logic**: Conditional blocks that check for stored Quick Tabs and
  recreate them after browser restart
- **Migration logic**: Code that moves Quick Tabs data between storage schema
  versions
- **Persistence hooks**: Event handlers that automatically save state after
  creation, deletion, or state changes (e.g., on `quickTabCreated`,
  `quickTabDestroyed`, minimize/restore events)

---

## 3. Version-Based Log History Cleanup

### 3.1 Design Principle

When the user downloads and installs a new version of the extension, the log
history accumulated in the previous version should be automatically cleared.
This prevents:

- Old logs cluttering exported debug files
- Confusion about which logs belong to which version
- Storage waste from accumulating logs across many version updates

### 3.2 Functional Scope

Implement the following version-based cleanup:

1. **Version detection**: On every extension load (or periodically), detect the
   currently installed version.
2. **Version comparison**: Compare it with the last-recorded version stored in
   `browser.storage.local`.
3. **Cleanup trigger**: If the version has changed (upgraded), clear all
   accumulated logs.
4. **Version update**: Record the new version as the "last-known version."

### 3.3 Key Locations for Implementation

**Logging System:**

- The logger module (likely `src/utils/logger.js`, `src/logging/Logger.js`, or
  similar) must have a method to clear all stored logs (e.g., `clearAllLogs()`
  or `clearHistory()`).
- The logger must support querying current log count and storing logs in a
  structured way (not just in-memory).

**Storage:**

- `browser.storage.local` must store a key for "current extension version"
  (e.g., `extensionVersion`, `lastKnownVersion`, or `_version`).
- `browser.storage.local` must store accumulated logs with a way to identify
  them (e.g., under a key like `debugLogs`, `logHistory`, or within a structured
  object).

**Initialization:**

- **Primary location**: `background.js` or a dedicated initialization module
  (e.g., `src/background/init.js`, `src/background/startup.js`)
- On extension load or at startup, the background script should:
  1. Read the current extension version from `manifest.json` (via
     `browser.runtime.getManifest()`)
  2. Read the stored version from `browser.storage.local`
  3. Compare versions
  4. If different, invoke the logger's clear method and update the stored
     version

**Alternative approach**: A separate module for version management (e.g.,
`src/background/VersionManager.js`) that handles all version-related logic,
including log cleanup.

### 3.4 Implementation Strategy

**Entry point**: The background script's initialization routine (as early as
possible after extension load, before any logging is performed).

**Version check function** (pseudo-code structure):

```
- Get manifest version via browser.runtime.getManifest().version
- Retrieve stored version from browser.storage.local[extensionVersion]
- If stored version is undefined or different from manifest version:
  - Call logger.clearAllLogs() or equivalent
  - Update browser.storage.local[extensionVersion] to manifest version
  - Optionally log "Logs cleared on upgrade from X to Y"
```

**Timing**: This check must run:

- On every background script startup (which typically happens when extension is
  first loaded or after browser restart)
- Alternatively, it can check periodically (e.g., on the first tab open of each
  session)

**Storage keys to create/monitor**:

- `extensionVersion` — Stores the last-known version
- Ensure the logger's storage key (e.g., `debugLogs` or similar) is known and
  can be selectively cleared

### 3.5 Files Requiring Modification

**Logging system**:

- Logger module — Add or expose a `clearAllLogs()` method (if not already
  present)

**Storage/Background startup**:

- `background.js` — Add version-check logic early in the initialization sequence
- Or create a new `src/background/VersionManager.js` that handles version
  detection and log cleanup

**Manifest** (if needed):

- `manifest.json` — Ensure `version` field is properly defined; this is the
  source of truth for the current extension version

---

## 4. Scanning Checklist

When implementing these changes, systematically scan through the entire codebase
for:

### Solo/Mute Removal

- [ ] Search for `solo` (case-insensitive) in all `.js` and `.html` files
- [ ] Search for `mute` (case-insensitive) in all `.js` and `.html` files
- [ ] Search for event names `SOLO_*`, `MUTE_*` in state-machine.js and
      mediator.js
- [ ] Search for storage keys containing `solo` or `mute` in
      SyncStorageAdapter.js
- [ ] Search for button IDs or data-attributes containing `solo` or `mute` in UI
      templates
- [ ] Review state objects in Quick Tabs manager to remove solo/mute properties
- [ ] Check for UI tooltips or labels mentioning Solo or Mute

### Persistence Removal

- [ ] Search for `browser.storage.local.set` and `browser.storage.local.get`
      related to Quick Tabs
- [ ] Search for `SyncStorageAdapter` calls with Quick Tabs context
- [ ] Find all calls to storage read/write within `src/features/quick-tabs/*`
- [ ] Identify initialization code that restores Quick Tabs from storage
- [ ] Remove migration handlers that restore Quick Tabs across versions
- [ ] Check for lazy-loading or restoration logic in managers
- [ ] Verify that Quick Tabs UI does not attempt to load from storage

### Version-Based Log Cleanup

- [ ] Verify `manifest.json` has a `version` field
- [ ] Identify the main logger module and its storage key
- [ ] Locate `background.js` or the main startup initialization
- [ ] Confirm where `browser.runtime.getManifest()` should be called
- [ ] Design the version check logic placement (early in init, before any
      logging)
- [ ] Ensure the logger can be called to clear all logs at startup

---

## 5. Summary of Objectives

1. **Remove Solo/Mute completely**: Eliminate all state flags, event handlers,
   UI controls, persistence, and conditional logic related to Solo and Mute
   functionality. The end state should have no concept of "solo" or "muted"
   Quick Tabs.

2. **Eliminate Quick Tabs persistence**: Prevent Quick Tabs from being saved to
   `browser.storage.local` and restored on browser restart. Every browser
   session should start with zero Quick Tabs; they are created fresh by user
   interaction.

3. **Implement version-based log cleanup**: On extension update, automatically
   detect the version change and clear all accumulated log history. This ensures
   that exported logs only contain entries from the current version session.

These changes simplify the Quick Tabs architecture by removing stateful
complexity, reducing storage usage, and ensuring clean debug logs per version.
