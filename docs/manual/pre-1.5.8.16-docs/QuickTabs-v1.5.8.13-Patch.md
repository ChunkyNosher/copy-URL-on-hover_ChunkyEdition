# Patch Guide for Quick Tabs Persistence, Position Sync, and Eager Loading (v1.5.8.13)

## Overview

This guide details the optimized architecture and step-by-step changes required
to resolve Issue #35 (cross-tab persistence), Issue #51 (global position/size
synchronization), and also covers expected behaviors from Issue #47 and how to
implement robust Eager Loading for the Quick Tabs feature in the
copy-URL-on-hover extension. It references the current v1.5.8.12 codebase and
includes additional recommendations for debug and future-proofing. The steps are
organized for clarity and Github Copilot compatibility, including
troubleshooting/debug instructions for v1.5.8.13.

---

## 1. Core Requirements and Scenarios

- **Persist Quick Tabs across all tabs:** When opening, moving, resizing, or
  minimizing a Quick Tab in any browser tab, that state must reflect in all
  other tabs immediately (per Issue #35 and #51).
- **Preserve state on tab switch and browser restart:** All Quick Tabs (with
  their minimized state, position, size, and pin status) should persist and
  restore seamlessly per [Issue #47 detailed workflows][47].
- **Full cross-domain/cross-container support in Firefox:** State sync should
  work across different domains and Firefox containers if possible.
- **Quick Tabs Manager** must reflect real state in all browser contexts, not
  only the tab where changes occurred.

---

## 2. Eager Loading Explained & Refactor Rationale

**Eager Loading:** All Quick Tabs logic (listeners, state hydration, broadcast
setup) must run as soon as the extension or tab loads—never wait for UI
activation or user interaction. This is crucial for sync and state restoration.

**When to use Eager Loading:**

- Sync and real-time features (e.g., Quick Tabs sync, manager panel hydration)
- Background event listeners (BroadcastChannel, storage events)
- State managers that coordinate UI across browser contexts

**When to use Lazy Loading:**

- Very large optional UI components
- Developer tools, settings panels that aren't used for core features

**Why Eager Loading is required here:**

- Lazy loaded listeners/UI cannot sync or hydrate when inactive—leading to
  broken state, unsynced Quick Tabs, and user confusion.
- All tabs/windows must "hear" broadcast/storage events the moment an extension
  context loads.
- Immediate rehydration ensures restored state on tab switch/reload.

---

## 3. Implementation Steps (File-by-File)

### background.js

**Goal:** All event listeners (message, tab updates, storage, broadcast) are
always registered, and state is hydrated on load.

- Move all listener registration (BroadcastChannel, browser.storage.onChanged,
  runtime.onMessage, tabs.onActivated, etc.) to the global scope at the top of
  the file. Never register listeners within UI or user interaction handlers.
- Ensure initializeGlobalState() and relevant sync logic run as soon as
  background context loads—never after user interaction.
- Persist and broadcast updates for every Quick Tab operation (create, update,
  move, resize, minimize, restore, pin/outpin, close) using both storage sync
  and immediate tab message dispatch.
- On tab activation, always attempt to sync relevant Quick Tab state for that
  tab's context (using containerId if available).
- Debug: Add console logging for every major storage/broadcast/update event,
  including which listeners are triggered and in which context.

### content.js (or equivalent content script)

- On content script load, immediately attach message and storage listeners
  necessary for Quick Tab coordination, regardless of UI state.
- Immediately fetch and hydrate Quick Tab state from storage or
  background/sidepanel when content.js loads.
- When a Quick Tab is created, moved, resized, minimized, restored, or closed in
  any tab, always update storage and broadcast via channel for native real-time
  sync.
- Respond to all message and storage events to update local Quick Tab UI—do not
  require UI activation as a prerequisite.

### State/Sync Manager Files

- Ensure any manager or state class that coordinates cross-tab state loads
  eagerly and listens for events from the moment the file is loaded.

### manifest.json

- Ensure background scripts are set as persistent for MV2 (as in v1.5.8.12) for
  reliability in Firefox. For future Manifest V3 migration, consider
  non-persistent/event-driven backgrounds as required by the browser.

---

## 4. Additional Fixes for Issue #51 (Global Position/Size Sync)

- Every time the user drags or resizes a Quick Tab (in any tab or context),
  immediately update global state (via storage and broadcast).
- When switching tabs, always restore Quick Tabs at the latest known position
  and size, regardless of the tab's previous state.
- Use a unique tab/id structure to track global state accurately.

---

## 5. Debugging and Testing v1.5.8.13

### Debugging

- Enable verbose logging at every broadcast, state mutation, or UI rehydration
  event.
- Debug common pitfalls:
  - Listeners not attached in content/background scripts
  - Race conditions between storage writes and reads (see [best practices][208])
  - Container boundary (cookieStoreId) mismatches
  - Storage permissions or quotas exceeded
- Use browser devtools for background and content scripts; check both console
  and network tabs for sync events.

### Testing

- Open multiple tabs different domains, create/resize/minimize/restore all Quick
  Tabs and verify instant sync
- Close and reopen the browser/session and verify full restore
- Pin/unpin Quick Tabs and verify visibility/scoping in all tabs
- Try drag/resize while rapidly switching tabs
- Observe for flicker, delayed UI, or stale state—these indicate listeners are
  missing or not eager-loaded

---

## 6. Final Copilot Instructions/Checklist

- Eager-load all state, listener, and sync logic on script/background/content
  start
- Refactor any listeners that are only registered after a UI/manager is
  open—move them to top of file
- Any state hydration, storage reading, or broadcast setup should occur
  immediately on load
- Remove logic that requires the user to open the manager or otherwise
  "activate" a feature before its core functionality works
- For future extensibility, retain lazy loading only for volitional, infrequent,
  or large UI modules

---

## References

- [Issue #35: Quick Tabs don't persist across tabs][35]
- [Issue #51: Size and position sync between tabs][51]
- [Issue #47: Intended Quick Tabs behaviors][47]
- [MDN: Background scripts best practices][208]
- [Best practices for eager loading/ext APIs][learn.microsoft.com]

[35]: https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/35
[51]: https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/51
[47]: https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/47
[208]:
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts
[learn.microsoft.com]:
  https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/minimize-extension-impact
