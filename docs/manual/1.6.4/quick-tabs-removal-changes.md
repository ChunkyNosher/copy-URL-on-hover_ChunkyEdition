# Quick Tabs Extension: Solo/Mute Removal, Persistence Removal & Log Cleanup on Upgrade

**Document Version:** 1.0  
**Date:** December 24, 2025  
**Extension Version Target:** v1.6.3.11-v9+  
**Scope:** Complete removal of solo/mute audio functionality, elimination of
Quick Tabs persistence across browser restarts, and automatic log cleanup on
version upgrades

---

## Overview

This document outlines three distinct architectural removals/changes required
for the Quick Tabs extension:

1. **Solo/Mute Audio Functionality Removal** - Remove all audio control UI
   elements, event handlers, and related business logic
2. **Quick Tabs Persistence Removal** - Ensure Quick Tabs do NOT persist when
   browser restarts (they remain session-temporary)
3. **Log History Cleanup on Upgrade** - Clear all diagnostic logs when extension
   updates to a new version

---

## Part 1: Solo/Mute Audio Functionality Removal

### Severity

🔴 **HIGH** - This feature touches multiple layers: UI, handlers, storage, and
background coordination

### Root Cause Analysis

The Quick Tabs extension currently includes audio muting/solo controls that need
to be completely removed. This functionality likely exists in:

#### **Files That Need Scanning:**

**UI Layer (HTML/CSS/JS):**

- **`src/ui/quick-tab-window.html` or equivalent Quick Tab HTML template**
  - Look for: `<button>` or `<div>` elements with IDs/classes like `mute-btn`,
    `solo-btn`, `audio-btn`, `volume-*`, `sound-*`
  - Look for: Toolbar elements referencing audio control icons
  - Look for: CSS classes for audio button styling (`btn-mute`, `btn-solo`,
    `.audio-control`, `.volume-*`)
- **`src/ui/manager-panel.html` or Quick Tabs Manager UI**
  - Look for: Manager settings/controls for mute/solo functionality
  - Look for: Status indicators showing mute state (icons, labels)
  - Look for: Batch operations affecting audio (mute-all, unmute-all buttons)

**JavaScript Handler Layer:**

- **`src/features/quick-tabs/handlers/CreateHandler.js`**
  - Look for: Mute/solo state initialization when creating new Quick Tab
  - Look for: Properties like `isMuted`, `muteState`, `soloEnabled`,
    `audioMuted`, `isSolo`
  - Look for: Storage initialization of audio properties

- **`src/features/quick-tabs/handlers/UpdateHandler.js`**
  - Look for: Event handlers for mute/solo button clicks
  - Look for: State update logic triggered by audio control interactions
  - Look for: Persistence of mute/solo state to storage

- **`src/features/quick-tabs/handlers/VisibilityHandler.js`**
  - Look for: Logic that shows/hides mute/solo controls based on Quick Tab
    visibility
  - Look for: Z-index or DOM manipulation related to audio controls

- **`src/features/quick-tabs/coordinators/UICoordinator.js`**
  - Look for: Event listeners for mute/solo button events
  - Look for: UI state updates reflecting audio control state
  - Look for: Communication between Quick Tab window and manager for audio state

**Core Quick Tab Window:**

- **`src/features/quick-tabs/QuickTabWindow.js`**
  - Look for: Methods like `toggleMute()`, `setSolo()`, `muteAudio()`,
    `unmuteAudio()`, `getAudioState()`
  - Look for: Properties storing audio state (`muteState`, `isMuted`,
    `soloActive`)
  - Look for: Event handler bindings for audio control UI elements
  - Look for: DOM references to mute/solo buttons

**Storage/Persistence:**

- **`src/utils/StorageUtils.js`** or storage serialization module
  - Look for: Serialization of `muteState`, `isMuted`, `soloEnabled` properties
  - Look for: Deserialization logic restoring audio state from storage
  - Look for: Storage keys like `quickTab_audioState`, `tab_muteStatus`,
    `soloState`

- **`src/features/quick-tabs/handlers/UpdateHandler.js`** (storage persistence
  section)
  - Look for: Calls to `persistStateToStorage()` that include audio properties
  - Look for: State validation checking for audio properties

**Background/Content Communication:**

- **`src/background.js`** or equivalent
  - Look for: Message handlers for `MUTE_TAB`, `SOLO_TAB`, `UNMUTE_TAB`,
    `GET_AUDIO_STATE` messages
  - Look for: Broadcast logic for audio state changes across tabs/windows

- **`src/content.js`** or equivalent
  - Look for: Message senders for mute/solo operations
  - Look for: Audio state requesters from background

### What Needs to Change

#### **Step 1: Remove UI Elements**

Search all HTML/template files for audio control UI:

- Remove `<button>` elements with `id` or `class` containing: `mute`, `solo`,
  `audio`, `sound`, `volume`
- Remove associated CSS styling for these buttons (from inline `<style>` blocks
  or linked stylesheets)
- Remove audio control icons/images if they exist
- Remove any toolbar space/layout that was reserved for audio buttons
- Remove any status indicators showing mute/solo state (badges, labels)
- Remove any context menu items related to mute/solo/audio

This removal must be surgical - only audio controls, not affecting drag handles,
minimize buttons, close buttons, or other toolbar elements.

#### **Step 2: Remove JavaScript Event Handlers**

In QuickTabWindow or UI coordination modules:

- Remove all methods with names containing `Mute`, `Solo`, `Audio`, `unmute`,
  `toggleAudio`
- Remove click/change event listeners bound to audio control elements
- Remove any state machine transitions triggered by audio events
- Remove audio property getters/setters
- Remove any audio state validation logic

In UpdateHandler:

- Remove all event handlers responding to audio control interactions
- Remove audio-specific state update branches
- Remove audio property mutations

In UICoordinator:

- Remove event listeners for audio events from Quick Tab windows
- Remove message handlers for audio-related messages
- Remove UI refresh logic that updates audio control appearance

#### **Step 3: Remove State Properties**

Search codebase for audio-related state properties:

- Remove class properties like `this.muteState`, `this.isMuted`,
  `this.soloEnabled`, `this.audioActive`
- Remove storage key definitions for audio state
- Remove audio state initialization in constructors
- Remove audio state in object destructuring patterns

#### **Step 4: Remove Storage Serialization**

In StorageUtils or equivalent:

- Remove logic that reads/writes audio properties from `browser.storage.local`
- Remove audio property validation in serialization
- Remove audio state from any object transformation functions
- Remove audio-related storage keys from any storage schema definition

In UpdateHandler's persistence layer:

- Remove audio properties from `persistStateToStorage()` operations
- Remove audio state from pre/post-validation checks
- Remove audio properties from state hash/fingerprint calculations

#### **Step 5: Remove Background/Content Communication**

In background.js:

- Remove message handlers for: `MUTE_TAB`, `SOLO_TAB`, `UNMUTE_TAB`,
  `GET_AUDIO_STATE`, `TOGGLE_MUTE`, `SET_AUDIO_*`
- Remove any broadcast/notification logic for audio state changes
- Remove audio state queries sent to content scripts

In content.js:

- Remove message senders for mute/solo operations
- Remove audio state request code
- Remove any Web Audio API interactions if they exist

#### **Step 6: Clean Up Diagnostic Logs**

Search all handler and coordinator files for log statements containing:

- `audio`, `mute`, `solo`, `sound`, `volume` keywords in log messages
- Remove or clean up these log statements (preserve other logging context)

#### **Step 7: Remove from Manager Panel**

If manager has a UI:

- Remove mute/solo controls from manager Quick Tab list items
- Remove status indicators showing audio state
- Remove batch audio operations (mute-all, solo-this, etc.)
- Remove audio-related context menu items in manager

---

## Part 2: Quick Tabs Persistence Across Browser Restart Removal

### Severity

🟡 **MEDIUM** - Architectural change affecting when/how Quick Tabs are written
to persistent storage

### Design Principle

Per your requirement, Quick Tabs should be designed as **temporary
session-scoped windows**. They should:

- Persist **within a single browser session** (survive page reload, tab switch)
- **NOT persist** after browser close and reopen
- **NOT persist** after complete browser restart

### Root Cause Analysis

Currently, the extension likely persists ALL Quick Tab state (position, size,
open/closed status, minimized state) using `browser.storage.local`. Per Firefox
documentation, `browser.storage.local` data persists indefinitely until
explicitly cleared or uninstalled. This causes Quick Tabs to be restored on
browser restart.

#### **Files Affected:**

**Storage Initialization:**

- **`src/background.js`** or initialization module
  - Look for: Code that loads Quick Tabs from `browser.storage.local` on
    extension startup
  - Look for: Hydration logic that recreates Quick Tabs based on persisted state

- **`src/content.js`** or content initialization
  - Look for: Page load handlers that query storage for Quick Tabs to restore
  - Look for: `browser.storage.local.get()` calls during page initialization

**Storage Writing:**

- **`src/utils/StorageUtils.js`** or storage module
  - Look for: All `browser.storage.local.set()` operations
  - Look for: Any long-term persistence strategy

- **`src/features/quick-tabs/handlers/UpdateHandler.js`** and
  **VisibilityHandler.js**
  - Look for: Calls to `persistStateToStorage()`
  - Look for: Debounced/throttled storage writes

**Storage Reading/Hydration:**

- **`src/features/quick-tabs/coordinators/UICoordinator.js`**
  - Look for: `browser.storage.onChanged` listener setup
  - Look for: Storage read on initialization

### What Needs to Change

#### **Step 1: Shift Storage Strategy**

The key distinction:

- **Session Storage:** Use `browser.storage.session` (Manifest V3) or in-memory
  state that dies on page unload
- **Persistent Storage:** Currently using `browser.storage.local` - this should
  be REMOVED for Quick Tabs

**Decision Point:**

- For **Quick Tab position/size within same browser session**: Use
  `browser.storage.session` (survives page reload, NOT browser restart)
- For **Quick Tab data within same page session**: Use in-memory state or
  `sessionStorage` equivalent

#### **Step 2: Replace Storage Layer**

Find all `browser.storage.local` calls related to Quick Tabs:

- Replace persistence calls (`.set()`) with `browser.storage.session.set()`
  where appropriate
- Replace read calls (`.get()`) with `browser.storage.session.get()` for session
  data
- Remove any long-term storage writes that expect data to survive browser
  restart

The distinction:

- `browser.storage.local` = persists indefinitely ❌ (REMOVE for Quick Tabs)
- `browser.storage.session` = persists until browser close ✅ (USE for Quick
  Tabs)
- In-memory state = dies on page unload/reload (depends on use case)

#### **Step 3: Remove Startup Hydration**

In background.js or initialization:

- Remove code that queries `browser.storage.local` for persisted Quick Tabs on
  startup
- Remove logic that reconstructs Quick Tabs from stored state during extension
  load
- Remove any "restore previous session" functionality that reads from persistent
  storage

In content.js:

- Remove any page load handlers that restore Quick Tabs from persistent storage
- Remove Quick Tab recreation based on previously stored state
- Keep page reload hydration (within same browser session) but NOT cross-session

#### **Step 4: Preserve Session-Scoped Persistence**

Keep this functionality:

- Quick Tabs DO persist when page is reloaded (Ctrl+R) - use
  `browser.storage.session`
- Quick Tabs DO persist when switching between tabs and coming back - use
  `browser.storage.session`
- Quick Tabs DO persist when minimized/restored within same session - use
  `browser.storage.session`

Remove this functionality:

- Quick Tabs NOT persisted when browser completely restarts
- Quick Tabs NOT persisted across browser shutdown/reopening

#### **Step 5: Update Logging**

Search for diagnostic logs containing "persist", "restore", "hydrate",
"session":

- Add clarification in logs:
  `[STORAGE_WRITE] Using browser.storage.session (not persistent across browser restart)`
- Add warning logs if code attempts to use `browser.storage.local` for Quick
  Tabs:
  `[STORAGE_WARNING] Attempted write to .local storage for Quick Tabs (should use .session)`

#### **Step 6: Update Tests/Documentation**

If tests exist:

- Remove test scenarios expecting Quick Tabs to persist across browser restart
- Update test setup that assumes persistent storage
- Add tests verifying Quick Tabs DO NOT restore after browser closes

---

## Part 3: Log History Cleanup on Version Upgrade

### Severity

🟡 **MEDIUM** - Data cleanup during version transitions

### Root Cause Analysis

When the extension updates, all diagnostic logs from the previous version remain
in `browser.storage.local` (or wherever logs are stored). These old logs:

- Pollute the current session's logs
- May expose behavior from outdated code paths
- Accumulate storage space over time
- Confuse debugging (old version logs mixed with new version logs)

The solution is to detect version upgrades and automatically clear old logs.

#### **Files Affected:**

**Version Upgrade Detection:**

- **`src/background.js`**
  - Look for: Extension initialization code
  - Look for: Any version checking logic
  - Look for: `browser.runtime.onInstalled` listener setup

**Log Storage:**

- **`src/utils/LoggingSystem.js`** or equivalent logging module
  - Look for: All log writes to `browser.storage.local`
  - Look for: Log key definitions (e.g., `logs`, `diagnosticLogs`,
    `quickTabsLogs`)
  - Look for: Log rotation/management logic

**Manifest:**

- **`manifest.json`**
  - Look for: `version` field defining current extension version

### What Needs to Change

#### **Step 1: Implement Version Upgrade Detection**

In background.js, add or enhance the `browser.runtime.onInstalled` listener:

The listener should:

- Detect when the extension updates (reason === "update")
- Read the extension manifest to get current version
- Access `browser.runtime.getPreviousExtensionVersion()` OR read version from
  storage
- Compare current vs previous version
- If version changed, trigger log cleanup

Per Mozilla documentation, the `browser.runtime.onInstalled` event includes:

- `reason` property: "install", "update", or "browser_update"
- `previousVersion` property: only available when reason is "update"

#### **Step 2: Create Log Cleanup Function**

Create a new function responsible for:

- Clearing ALL logs from `browser.storage.local` (or wherever logs are stored)
- Clearing log metadata (timestamps, entry counts, indices)
- Clearing any log rotation history
- NOT clearing extension settings/user data (only logs)

The function should be named clearly: `clearExtensionLogs()`,
`wipeDiagnosticLogs()`, or similar.

#### **Step 3: Wire Cleanup on Upgrade**

In the `browser.runtime.onInstalled` listener:

```
if (details.reason === 'update') {
  clearExtensionLogs();
  // Optionally log that cleanup occurred
}
```

This ensures:

- Every time the extension updates, logs are automatically wiped
- No manual user intervention required
- New version starts with clean logs

#### **Step 4: Identify Log Storage Keys**

Find all storage keys where logs are written. Search for:

- `browser.storage.local.set(...)` calls where the key name contains "log",
  "diagnostic", "history", "record"
- Common patterns: `quickTabsLogs`, `logs`, `extLogs`, `diagnostics`, `eventLog`
- Remove these keys entirely on upgrade

#### **Step 5: Update Storage Cleanup Implementation**

The cleanup function must:

- Call `browser.storage.local.remove()` with an array of all log-related keys
- OR call `browser.storage.local.clear()` if logs are isolated in their own
  storage area
- Handle case where logs don't exist (first install) - should not throw

Add error handling:

- If storage cleanup fails, log it (but where? Use console.error)
- Silently continue - don't block extension startup if logs can't be cleared

#### **Step 6: Handle Race Conditions**

Consider timing:

- Version upgrade detection runs in background script
- Content scripts may try to write logs during the same time period
- Solution: Ensure `onInstalled` listener completes log cleanup BEFORE any
  content scripts start

Add to `onInstalled` listener:

- Wait for storage cleanup to complete (await the Promise)
- Only then proceed with other upgrade logic

#### **Step 7: Add Version Tracking**

Store the current version in storage for future comparisons:

- After upgrading/installing, write current version to `browser.storage.local`
  under key like `lastKnownVersion` or `extensionVersion`
- Next time `onInstalled` fires, compare this stored version with current
  version from manifest
- Prevents false-positive upgrades

Pseudocode pattern:

```
onInstalled listener:
  if (details.reason === 'update') {
    clearExtensionLogs();
  }

  // Track this version for next upgrade
  const manifest = browser.runtime.getManifest();
  browser.storage.local.set({ extensionVersion: manifest.version });
```

#### **Step 8: Test Upgrade Scenario**

Manual testing should verify:

1. Install extension v1 → logs accumulate
2. Upgrade to v2 → logs automatically cleared
3. Logs do NOT re-appear after browser restart
4. User data (Quick Tabs state, settings) are preserved (not deleted with logs)

---

## Implementation Priority

### Order of Execution (Recommended)

1. **Part 1: Solo/Mute Removal** (highest priority, lowest risk)
   - Clean, isolated feature removal
   - No architectural changes
   - Safe to remove without affecting other systems

2. **Part 3: Log Cleanup on Upgrade** (medium priority, low risk)
   - Simple, localized change
   - Only affects diagnostic logs
   - Easy to verify and test

3. **Part 2: Persistence Removal** (lower priority, higher risk)
   - Architectural impact on storage strategy
   - Must verify session persistence still works
   - Extensive testing required

### Cross-Cutting Concerns

**Storage Layer:**

- Part 2 modifies how storage is used
- Part 3 clears storage on upgrade
- Ensure these changes don't conflict:
  - Session storage cleanup should NOT happen on upgrades (keep session data
    within same session)
  - Only local/persistent storage should be wiped

**Testing Checklist:**

After implementation:

- [ ] Solo/mute UI elements completely removed from all tabs
- [ ] No console errors referencing missing mute/solo handlers
- [ ] Quick Tab creation/deletion works without audio functionality
- [ ] Storage size does not increase due to audio state serialization
- [ ] Browser restart does NOT restore Quick Tabs
- [ ] Browser restart DOES clear logs from previous session
- [ ] Page reload within same session DOES restore Quick Tabs (session
      persistence works)
- [ ] Switching between tabs and back DOES maintain Quick Tab state within
      session
- [ ] User settings/data (max tabs, keyboard shortcuts, etc.) persist across
      restart
- [ ] No data loss of user preferences during upgrade

---

## Potential Risks & Mitigation

| Risk                                                        | Mitigation                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Removing audio feature breaks UI rendering**              | Comprehensively scan all HTML templates; test UI appearance after removal                |
| **Incorrect storage key removal causes data loss**          | Clearly identify and list all audio-related storage keys before removal; test in staging |
| **Session storage not available in older Firefox versions** | Check Firefox version requirements; `browser.storage.session` available in Firefox 102+  |
| **Logs cleared before being exported in some edge case**    | Ensure logs are only cleared during version upgrade, not on regular startups             |
| **Breaking change for users with existing Quick Tabs**      | Provide clear release notes; Quick Tabs simply won't restore (expected behavior change)  |

---

## Summary of Changes by File

### Files to Modify (Audio Removal)

- `src/ui/quick-tab-window.html` - Remove mute/solo button UI
- `src/ui/manager-panel.html` - Remove audio state indicators
- `src/features/quick-tabs/QuickTabWindow.js` - Remove audio methods/properties
- `src/features/quick-tabs/handlers/CreateHandler.js` - Remove audio
  initialization
- `src/features/quick-tabs/handlers/UpdateHandler.js` - Remove audio event
  handlers
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - Remove audio UI
  logic
- `src/features/quick-tabs/coordinators/UICoordinator.js` - Remove audio event
  listeners
- `src/utils/StorageUtils.js` - Remove audio serialization
- `src/background.js` - Remove audio message handlers
- `src/content.js` - Remove audio message senders

### Files to Modify (Persistence Removal)

- `src/background.js` - Remove hydration of Quick Tabs from persistent storage
- `src/content.js` - Update initialization to use session storage
- `src/features/quick-tabs/handlers/UpdateHandler.js` - Change
  `browser.storage.local` to `browser.storage.session`
- `src/utils/StorageUtils.js` - Update serialization to use session storage
- `src/features/quick-tabs/coordinators/UICoordinator.js` - Update storage
  read/write patterns

### Files to Modify (Log Cleanup on Upgrade)

- `src/background.js` - Add/enhance `browser.runtime.onInstalled` listener with
  log cleanup
- `src/utils/LoggingSystem.js` - Create log cleanup function, export cleanup API

---

## References

**Mozilla WebExtension Documentation:**

- `browser.runtime.onInstalled`: Fires on extension install/update
- `browser.storage.session` vs `browser.storage.local`: Session storage doesn't
  persist across browser restart
- `browser.runtime.getManifest()`: Access manifest including version field
- `browser.storage.local.remove()`: Clear specific storage keys

---

**Notes for Copilot Coding Agent:**

When implementing these changes:

1. **Do NOT** provide exact code - identify problematic patterns and describe
   conceptual fixes
2. **Do** provide specific file paths and function names to search for
3. **Do** indicate which architectural decisions need changing (e.g., storage
   strategy shift)
4. **Do** reference the diagnostic logs from previous extension runs to
   understand current behavior
5. **Do** ensure all three changes work together without conflicts (storage
   layer especially)
