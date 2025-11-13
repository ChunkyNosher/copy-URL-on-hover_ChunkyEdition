# Implementation Guide: Adopting the Hybrid Modular/EventBus Architecture (Architecture #10) for copy-URL-on-hover v1.5.8.9+

**Date:** 2025-11-13
**For:** Copilot Agent, Core Maintainer Team

---

## 1. Executive Summary

This guide details how to migrate the most recent version of the extension to the most robust and scalable modular architecture (Hybrid Architecture #10: Feature Modules + Core Services + EventBus). It addresses:

- Breaking out UI from content.js
- Restoring Quick Tabs as overlays
- Modularizing notifications
- Wiring features via EventBus and background messaging
- Ensuring scalability, maintainability, and clarity

---

## 2. Target Directory Structure

```
src/
  content.js                 # Entry Point: orchestrates imports, main listeners
  core/
    config.js                # Loads user config, schema validation
    state.js                 # Global/feature state manager singleton
    events.js                # EventBus implementation
    dom.js                   # DOM helpers
    browser-api.js           # Browser/extension API wrappers
  features/
    quick-tabs/
      index.js               # Quick Tab event registration, state, overlay wiring
      window.js              # UI logic for creating/destroying overlays
      minimized-manager.js   # Minimized tabs bar
    notifications/
      index.js               # Public API for showToast/showTooltip
      toast.js
      tooltip.js
    url-handlers/
      index.js
      generic.js
  ui/
    components.js            # All reusable UI widgets
    css/
      quick-tabs.css
      notifications.css
      base.css
```

---

## 3. Migration Steps

### 3.1. Create Modular Notification System

- Move "showTooltip" and "showToast" into features/notifications/
  - notifications/index.js should export { showTooltip, showToast }
  - Use CSS modules (features/notifications/toast.css, tooltip.css)
- In content.js, **import** notification functions and use them directly
- Ensure only Copy URL shows with tooltip; only Quick Tab shows with toast (see 3.3)

### 3.2. Restore Quick Tab UI Module

- Create features/quick-tabs/window.js:
  - Exports: createQuickTabWindow(opts), destroyQuickTab(id), etc.
  - Handles DOM rendering for overlays, drag/move/resize/minimize
  - Should receive all required options (position, URL, tab meta)
  - Cleans up all elements on close
  - Connects to EventBus for local triggers and background-initiated restoration
- In features/quick-tabs/index.js:
  - Register listeners: EventBus.on(Events.QUICK_TAB_REQUESTED, ...)
  - Listen for browser.runtime.onMessage for cross-tab/restore triggers

### 3.3. Decouple Content.js and Use EventBus Exclusively

- content.js only listens for global events (keyboard, mouse, API-ready)
- On shortcut, emit event: EventBus.emit(Events.QUICK_TAB_REQUESTED, data)
- Notification logic: if (event.type === copyUrl) showTooltip(...); else if (event.type === quickTab) showToast(...);
- Remove ALL feature-specific code from content.js
- Ensure each feature registers itself with EventBus in its own index.js

### 3.4. Improve Core Utilities

- core/config.js: Always retrieve config as individual keys from browser.storage.local, not nested object
- core/state.js: Singleton with public API for common shared state and feature-local state
- core/events.js: Robust EventBus supporting on, off, emit, once; global singleton
- core/dom.js: Helper for element creation, mounting, removal, and CSS isolation
- core/browser-api.js: Thin wrappers for messaging, storage, tab APIs

### 3.5. Modularize URL Handlers

- features/url-handlers/index.js is the public registry
- Add new sites as new files under url-handlers/
- Each handler registers with the main registry

### 3.6. UI Component Breakdown

- All overlays (quick tab windows, notification toasts, tooltips, minimized bar) should be small, idiomatic modules
- Each uses CSS from ui/css/ directory
- Avoid duplicating DOM logic - all widget creation via ui/components.js

### 3.7. Testing, Build, and Maintenance

- Add end-to-end integration test for quick tab workflow: creation → minimize → restore → close
- Validate notification UIs via isolated test harness
- Confirm all modules are imported in entry (content.js), not only referenced
- Document module APIs through README.md files per feature
- Set up Rollup/Webpack config to auto-bundle all modules into one content.js

---

## 4. FAQ & Common Pitfalls

- **Q:** Why didn’t Quick Tabs show up before?  
  **A:** UI-rendering logic was not modularized or registered, so overlay was missing
- **Q:** Why use an EventBus?  
  **A:** Enables features to scale independently—decouples event origin/handler
- **Q:** What about settings/config?  
  **A:** Only core/config.js touches storage; all features read configuration via injected dependency or EventBus
- **Q:** Can I add more features later?  
  **A:** Yes—just add a new feature directory, register on EventBus, and import in content.js

---

## 5. Example Event Flow: Quick Tab Creation

1. User presses shortcut. content.js emits Events.QUICK_TAB_REQUESTED
2. features/quick-tabs/index.js listens for event, calls createQuickTabWindow()
3. features/quick-tabs/window.js creates overlay, adds to DOM
4. features/notifications/index.js shows toast notification for Quick Tab creation
5. State sync events (background → content, e.g., for restore) are registered in quick-tabs/index.js

---

## 6. Final Checklist

- [ ] No feature UI logic remains in content.js — only event orchestration
- [ ] Quick Tab windows are drawn by features/quick-tabs/window.js and destroyed on close
- [ ] Only Copy URL uses tooltip, only Quick Tabs use toast
- [ ] EventBus is used for ALL inter-feature signaling
- [ ] All overlays use modular CSS from ui/css/
- [ ] Config/state are managed by core/config.js, core/state.js singletons
- [ ] README.md in each feature for maintainers

---

**Migration Time Estimate:**

- Core migration: 2-3 days
- Feature module wiring: 2 days
- UI/notification refactor: 1 day
- Test/hardening: 2+ days

_Last updated: 2025-11-13. This guide integrates current repo scan details and is ready for direct use by Copilot automation._
