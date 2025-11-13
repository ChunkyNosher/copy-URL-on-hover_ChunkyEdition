# Proposed Architecture Changes to Solve Issue #51 in `copy-URL-on-hover_ChunkyEdition`

## Overview

This document provides a detailed roadmap for redesigning your Firefox extension to robustly solve the Quick Tabs position and size persistence problem across tabs/domains. It integrates modern Mozilla WebExtension best practices and recommends key new files and implementation strategies for reliable, cross-tab state synchronization.

---

## 1. Use Multiple Storage Layers: `browser.storage.sync` and `browser.storage.session`

**Why:** Sync offers reliability and cross-device support, session offers speed and temporary state, both can be used together for optimal results.

### Implementation

- **Replace usage of `browser.storage.local` with `browser.storage.sync`** for Quick Tabs' persistent state.
- **Layer session storage (`browser.storage.session`)** for very fast ephemeral sync (Firefox 115+).

**Example - `content.js` changes:**

```javascript
// New state-manager.js shared module (see section 5)
import { QuickTabStateManager } from "./state-manager.js";
const stateManager = new QuickTabStateManager();

// When moving Quick Tab
async function handleQuickTabMove(url, left, top) {
  const currentState = await stateManager.load();
  const updatedTabs = currentState.tabs.map((tab) =>
    tab.url === url ? { ...tab, left, top } : tab,
  );
  await stateManager.save(updatedTabs);
}
```

---

## 2. Create an Options Page for Better Settings Sync

**Why:** `options_ui` allows robust settings and config syncing using `storage.sync`.

**Files to Add:**

- `options_page.html`
- `options_page.js`

**manifest.json excerpt:**

```json
"options_ui": {
  "page": "options_page.html",
  "browser_style": true
}
```

**Sample API Functions in `options_page.js`:**

```javascript
// Save Quick Tab settings
function saveQuickTabSettings(data) {
  return browser.storage.sync.set({ quick_tab_settings: data });
}
```

---

## 3. Add a Sidebar Action for Live State Debugging

**Why:** Visualize Quick Tab states from all tabs in real-time for troubleshooting sync issues.

**Files to Add:**

- `sidebar/panel.html`
- `sidebar/panel.js`

**Sample manifest.json addition:**

```json
"sidebar_action": {
  "default_title": "Quick Tabs Manager",
  "default_panel": "sidebar/panel.html",
  "default_icon": "icons/icon-48.png"
}
```

**Sidebar Implementation:**

```javascript
// sidebar/panel.js
async function displayAllQuickTabs() {
  const tabs = await browser.tabs.query({});
  const container = document.getElementById("quick-tabs-list");
  // Show Quick Tab states for each tab
}
setInterval(displayAllQuickTabs, 2000);
```

---

## 4. Switch Background Script to Event Page Mode

**Why:** Event-based background scripts coordinate state; non-persistent scripts save resources and coordinate sync.

**manifest.json change:**

```json
"background": { "scripts": ["background.js"], "persistent": false }
```

**background.js enhancements:**

```javascript
// Listen for sync storage changes, broadcast them to all tabs
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.quick_tab_settings) {
    browser.tabs.query({}).then((tabs) => {
      tabs.forEach((tab) => {
        browser.tabs.sendMessage(tab.id, {
          action: "SYNC_QUICK_TAB_STATE",
          state: changes.quick_tab_settings.newValue,
        });
      });
    });
  }
});
```

---

## 5. Abstract State Logic: Shared Module File

**Why:** Avoid code duplication, centralize logic for reading/writing Quick Tab state.

**File to add:** `state-manager.js`

**state-manager.js**

```javascript
export class QuickTabStateManager {
  constructor() {
    this.stateKey = "quick_tabs_state_v2";
    this.sessionKey = "quick_tabs_session";
  }
  async save(tabs) {
    const state = { tabs, timestamp: Date.now() };
    await Promise.all([
      browser.storage.sync.set({ [this.stateKey]: state }),
      browser.storage.session.set({ [this.sessionKey]: state }),
    ]);
    return state;
  }
  async load() {
    const [sessionResult, syncResult] = await Promise.all([
      browser.storage.session.get(this.sessionKey),
      browser.storage.sync.get(this.stateKey),
    ]);
    return (
      sessionResult[this.sessionKey] ||
      syncResult[this.stateKey] || { tabs: [] }
    );
  }
}
```

---

## 6. Implementation Checklist

- Update manifest.json for new features: options UI, sidebar action, event page, web accessible resources (if needed)
- Modularize Quick Tab state sync in `state-manager.js`
- Create sidebar and options UI for debugging and persistent settings
- Refactor content/background scripts to use shared logic and enhanced sync
- Add session storage for fast ephemeral tab state
- Use throttled saves on drag/resize events AND force save on tab visibility changes

---

## 7. Migration & Compatibility Notes

- All changes are compatible with Firefox v115+ (required for browser.storage.session)
- Existing `background.js` and `content.js` should refactor to import/use the shared state manager
- Expanding to Chrome/Edge? Still use `storage.sync`; consider browser-polyfill for cross-browser calls

---

## 8. References

- MDN: Anatomy of an Extension (2025)[116]
- MDN: manifest.json (2025)[119]
- MDN: background scripts (2025)[121]
- MDN: browser.storage.sync/session (2025)[13][94]

---

## 9. Final Advice

Implement the above architecture for scalable, maintainable, and bug-resistant Quick Tab management that robustly solves cross-tab persistence issues.
