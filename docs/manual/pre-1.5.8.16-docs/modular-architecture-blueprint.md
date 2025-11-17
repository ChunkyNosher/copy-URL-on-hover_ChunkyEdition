# Modular Redesign Proposal: Best Practices for Future of Copy URL on Hover/Quick Tabs Extension

## Executive Summary

The current modular architecture fixes many code management issues from the
monolith, but still suffers from lost UI wire-up, complex event pipelines, and
unclear module boundaries. Below is a production-architecture proposal for a
robust, maintainable, high-performance modular extension that avoids all
code-in-content.js anti-patterns and enables easy addition of new features in
the future.

---

## 1. Principles of the Improved Modular Architecture

- **Separation of Concerns:** Each feature must have its own directory (with
  index.js and optional submodules) and clear API. No feature-specific UI logic
  or event handling in content.js unless strictly mediator logic.
- **Entry Point as Pure Orchestrator:** content.js only wires up core managers,
  imports feature entrypoints, and binds high-level event bus channels. All
  logic is fanned out to modules.
- **Clear Feature Registration:** Each feature registers itself on EventBus
  and/or any needed DOM listeners when its entrypoint is imported.
- **UI Components Decoupling:** All overlays (Quick Tab, notifications,
  toolbars, minimizers) are created by dedicated modules. No inlined DOM
  manipulation or CSS in content.js.
- **Utils/Core:** Utility code (DOM, browser API wrappers, config management,
  state, event system) is encapsulated and re-used by all features, never
  duplicated.

---

## 2. New Directory Structure Example

```text
src/
  content.js           (Entry point: imports managers and features)
  core/
    config.js
    state.js
    events.js
    dom.js
    browser-api.js
    quick-tab-schema.js
  features/
    quick-tabs/
      index.js         (Registers Quick Tab listeners, manages instances)
      quick-tab-window.js
      minimized-manager.js
    notifications/
      index.js         (Toast/tooltip logic, CSS)
    url-handlers/
      index.js         (Registry, site-specific)
      generic.js
    ... (more features)
  ui/
    components.js      (Declarative DOM for reusable UI parts)
    css/
      quick-tabs.css
      notifications.css
      base.css
```

---

## 3. Event Wiring and Code Entry

- In `content.js`:
  - Import core managers (config, state, events)
  - Import feature main entrypoints (e.g., `./features/quick-tabs/`)
  - Import notifications
  - Bind global listeners only (keyboard, high-level).
- In each feature, register for all relevant events directly, wire up background
  messaging as needed.

---

## 4. Quick Tabs as a Full Module Example

- `features/quick-tabs/index.js`:
  - Listens for QUICK_TAB_REQUESTED on EventBus
  - Calls `createQuickTabWindow(options)` (declared in quick-tab-window.js/doc)
  - Handles background messages for cross-tab/restore
  - Tracks all current quick tab windows in a manager singleton

- `features/quick-tabs/quick-tab-window.js`:
  - Encapsulates DOM node lifecycle for a single Quick Tab overlay
  - Handles move/resize/minimize events (Pointer Events, no
    requestAnimationFrame throttling)
  - Emits events back to manager for destroy/minimize

- `features/quick-tabs/minimized-manager.js`:
  - Maintains minimized state, draws/floats minimized manager overlay
  - Syncs state across tabs via BroadcastChannel and browser.storage.sync

- `features/notifications/index.js`:
  - Exports `showTooltip`, `showToast`, and notification CSS
  - Handles position/animation based on invocation (Copy URL vs Quick Tab)

---

## 5. UI & Styling

- Each major feature gets its own CSS file, imported as needed
- Shadow DOM for overlays or use CSS isolation where collision likely
- All UI creation is declarative - do not inject HTML via innerHTML, always use
  explicit DOM methods

---

## 6. Messaging & Sync Improvements

- All background/content/script communication is routed through typed message
  classes or enrichable POJOs.
- Use BroadcastChannel API for same-origin/same-extension cross-tab sync where
  possible, fallback to background for x-site
- State schema is versioned and upgraded seamlessly

---

## 7. Unit and Integration Testing

- Each feature exposes test hooks or can be stub-interacted in isolation
- Core managers have integration tests for state, event, and restore edge cases

---

## Migration Notes

- The above refactor can be performed incrementally: by first modularizing
  notification and Quick Tab UI logic, then progressively moving feature code
  out to their final directories while keeping compatibility wrappers for legacy
  structure.

---

## Conclusion

This structure provides full separation, maintainability, easier extensibility,
and best-in-class performance while preventing code rot caused by too many
content.js ad-hoc changes. Copilot Agent should prioritize restoring visible
modular overlays for Quick Tabs and notifications as the first implementation
step, then follow the above blueprint for further modular improvements.
