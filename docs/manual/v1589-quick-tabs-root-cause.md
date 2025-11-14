# Root Cause & Fix Report: Quick Tabs Not Visible in v1.5.8.9 (copy-URL-on-hover)

## Executive Summary

Despite correct event emission, Quick Tabs do not appear visually in v1.5.8.9
due to the **absence of UI logic** for rendering the tab windows/overlays in all
modular code examined. No quick-tabs module, manager, or window file is found or
loaded in the runtime source; this is why the notification fires and background
script confirms creation, but the overlay is never actually drawn. This is a
critical architectural regression from all monolithic (pre-v1.5.8.6) versions.

---

## Key Root Cause

### 1. **Missing UI Creation/Render Logic**

- **No file implements or exports Quick Tab overlay/window logic in any
  modularized source path:**
  - Searched all expected locations: `src/features/quick-tabs/index.js`,
    `.../manager.js`, `.../quick-tab-window.js`, flat and core variants
  - Found no `createQuickTabWindow`, `renderQuickTabOverlay`, or similar
  - Therefore, function (or class) for actually creating Quick Tab DOM is not
    present, thus cannot be dynamically imported or run by `initQuickTabs()` in
    content.js

### 2. **handleCreateQuickTab Function Only Emits Events**

- Correctly sends background message and fires notification
- Does **not** trigger any UI overlay nor implements callback/event listener
  that would show the Quick Tab to the user

---

## Full Fix Plan

### 1. **Add/Restore Quick Tab UI Module**

- Implement or restore Quick Tab window/overlay logic as a self-contained
  module:
  - Required: `createQuickTabWindow(options)`, `destroyQuickTab(id)`, and
    optionally a `QuickTabManager` to track all instances
  - UI should be declarative (create DOM node per quick tab with iframe, handle
    drag/move/resize/minimize)
  - Overlay should be added to the DOM on demand and completely cleaned
    up/destroyed when closed
- Import, register, and call `createQuickTabWindow` from both:
  - `handleCreateQuickTab()` (to open immediately upon tab creation)
  - Message/event listeners for background-to-content events (for cross-tab
    restoration)

### 2. **EventBus Integration**

- In the new module, add listeners on EventBus for:
  - `Events.QUICK_TAB_REQUESTED` (local creation)
  - Background-script echo events (like `CREATE_QUICK_TAB_FROM_BACKGROUND`, for
    state sync)
- When event fires, call UI creation routine, e.g.:
  ```js
  eventBus.on(Events.QUICK_TAB_REQUESTED, opts => createQuickTabWindow(opts));
  browser.runtime.onMessage.addListener(msg => {
    if (msg.action === 'CREATE_QUICK_TAB_FROM_BACKGROUND') createQuickTabWindow(msg);
  });
  ```

### 3. **Notification Handling Separation**

- **Copy URL:** Use tooltip notification (showTooltip), NOT toast
- **Quick Tab:** Use toast notification (showToast), NOT tooltip
- Update `handleCopyURL` and `handleCreateQuickTab` in content.js:

  ```js
  showTooltip('✓ URL copied!'); // for copy URL
  showToast('✓ Quick Tab created!', 'success'); // for Quick Tabs
  ```

  - If needed, add a new `showQuickTabNotification()` for clarity
  - Ensure config disables notification if not enabled

### 4. **Implementation Checklist**

- [ ] Create/restore `src/features/quick-tabs/window.js`
- [ ] Add core create/destroy logic, ensure support for move, resize, minimize
- [ ] Add EventBus and browser.runtime listeners for tab creation/restore events
- [ ] Edit `handleCreateQuickTab` to call the new overlay function
- [ ] Separate notifications by feature (tooltip for copy, toast for tabs)

---

## Additional Tasks: Modular Refactor Best Practices

1. Never move all critical UI functionality out of main codebase without
   actively importing it
2. Always test that user-facing overlays are drawn and cleaned up on all event
   pipelines
3. For new modular files, set up explicit entrypoints and test suite to cover
   creation, restore, update, and destroy

---

## Summary Table: Problems & Fix Actions

| Problem                              | Fix Action                                                      |
| ------------------------------------ | --------------------------------------------------------------- |
| No visible Quick Tabs after creation | Implement missing UI overlay module and wire all trigger events |
| Quick Tabs notification is tooltip   | Use showToast for Quick Tabs, tooltip for Copy URL              |
| No modular UI entrypoint registered  | Add import+init for quick-tabs window in main code              |

---

Last updated: v1.5.8.9 analysis complete. Copilot must implement the above to
restore visible Quick Tabs and correct notification display.
