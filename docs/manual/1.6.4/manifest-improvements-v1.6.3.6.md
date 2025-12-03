# Manifest.json Improvements for Enhanced Quick Tab Communication

**Extension Version:** v1.6.3.6  
**Document Created:** December 03, 2025  
**Priority:** High (Storage Quota) → Medium (Sessions, Containers)

---

## Executive Summary

This document outlines **four critical permission additions** and **one security fix** for `manifest.json` to improve Quick Tab state synchronization, prevent storage quota errors, and enable advanced features like crash recovery and container integration.

**Impact:** These changes directly address storage failures, improve cross-tab sync reliability, and lay groundwork for future features without requiring architectural rewrites.

---

## Changes Overview

| Change | Type | Priority | Impact |
|--------|------|----------|--------|
| Add `unlimitedStorage` | Permission | **HIGH** | Prevents quota errors, enables unlimited Quick Tab state storage |
| Add `sessions` | Permission | **MEDIUM** | Enables crash recovery, tab history tracking |
| Add `contextualIdentities` | Permission | **LOW-MEDIUM** | Better container support, event-based container tracking |
| Remove `state-manager.js` from `web_accessible_resources` | Security Fix | **MEDIUM** | Prevents web pages from reading Quick Tab state |

---

## Change 1: Add `unlimitedStorage` Permission

### Problem Statement

**Current Limitation:**  
`browser.storage.local` has a **5MB quota** by default. Quick Tab state includes position, size, minimized status, solo/mute arrays, and URL for each tab. With many Quick Tabs or complex state (container isolation, history tracking), this quota is easily exceeded.

**Evidence from Codebase:**  
- v1.6.0.12 migration notes mention storage quota issues as reason for moving from `storage.sync` to `storage.local`
- Background script logs show storage write failures under heavy Quick Tab usage
- No fallback mechanism exists when quota is exceeded → silent data loss

### Solution

Add `unlimitedStorage` to permissions array:

```json
"permissions": [
  "storage",
  "tabs",
  "webRequest",
  "webRequestBlocking",
  "<all_urls>",
  "cookies",
  "downloads",
  "unlimitedStorage"  // ← ADD THIS
],
```

### Benefits

1. **Prevents Storage Quota Errors**  
   Removes 5MB limit on `browser.storage.local`, allowing unlimited Quick Tab state persistence.

2. **No User Warning in Firefox**  
   Since extension already requests `<all_urls>`, no additional permission warning is shown to users during install.

3. **Enables IndexedDB Without Prompts** (Firefox-specific)  
   If future architecture uses IndexedDB for advanced queries, this permission eliminates user permission prompts.

4. **Future-Proofs Storage Architecture**  
   Supports advanced features like Quick Tab history, search indexing, and bulk operations without quota concerns.

### Implementation Notes

- **No Code Changes Required:** Existing `browser.storage.local` calls automatically use unlimited quota
- **Backward Compatible:** Existing stored data remains intact
- **Cross-Browser Support:** Chrome/Edge also respect this permission

### Acceptance Criteria

- [ ] `unlimitedStorage` added to `permissions` array in `manifest.json`
- [ ] Extension installs without new user warnings in Firefox
- [ ] Storage writes succeed with 100+ Quick Tabs (test case: create 100 Quick Tabs, verify all persist after browser restart)
- [ ] Console shows no "QuotaExceededError" messages

---

## Change 2: Add `sessions` Permission

### Problem Statement

**Current Gap:**  
When Firefox crashes or user force-closes browser, Quick Tab state may be lost if storage write hadn't completed. No mechanism exists to restore Quick Tabs from browser's session history.

**Missing Features:**
- Cannot restore Quick Tabs after crash
- Cannot track which tabs had Quick Tabs before close
- Cannot implement "undo close Quick Tab" feature
- Cannot access tab navigation history within Quick Tabs

### Solution

Add `sessions` to permissions array:

```json
"permissions": [
  "storage",
  "tabs",
  "webRequest",
  "webRequestBlocking",
  "<all_urls>",
  "cookies",
  "downloads",
  "unlimitedStorage",
  "sessions"  // ← ADD THIS
],
```

### Benefits

1. **Crash Recovery**  
   Use `browser.sessions.getRecentlyClosed()` to restore Quick Tabs after unexpected closures.

2. **Tab History Tracking**  
   Access navigation history within Quick Tabs (back/forward button state).

3. **"Undo Close" Feature**  
   Implement "Restore Last Closed Quick Tab" in Manager Panel.

4. **Cross-Device Sync** (Firefox Sync Users)  
   Session data syncs across devices if user has Firefox Sync enabled.

### Implementation Example

```javascript
// In background.js or QuickTabHandler
async function restoreClosedQuickTabs() {
  const sessions = await browser.sessions.getRecentlyClosed({ maxResults: 10 });
  
  // Filter for tabs that had Quick Tabs
  const quickTabSessions = sessions.filter(session => {
    return session.tab && globalQuickTabState.tabs.some(qt => 
      qt.originTabId === session.tab.sessionId
    );
  });
  
  // Present restore UI in Manager Panel
  return quickTabSessions;
}
```

### Acceptance Criteria

- [ ] `sessions` added to `permissions` array
- [ ] Extension can call `browser.sessions.getRecentlyClosed()` without errors
- [ ] Manager Panel shows "Recently Closed Quick Tabs" section (future feature)
- [ ] Quick Tabs can be restored after browser crash (future feature)

---

## Change 3: Add `contextualIdentities` Permission

### Problem Statement

**Current Limitation:**  
Extension uses `cookieStoreId` for container awareness, but relies on **passive detection** (reading tab's `cookieStoreId` property). No access to Firefox Containers API for:
- Querying available containers
- Listening to container creation/deletion events
- Creating Quick Tabs in specific containers programmatically
- Getting container metadata (name, color, icon)

**Codebase Evidence:**  
`state-manager.js` uses `getCurrentCookieStoreId()` which passively reads from active tab. No event listeners for container changes.

### Solution

Add `contextualIdentities` to permissions array:

```json
"permissions": [
  "storage",
  "tabs",
  "webRequest",
  "webRequestBlocking",
  "<all_urls>",
  "cookies",
  "downloads",
  "unlimitedStorage",
  "sessions",
  "contextualIdentities"  // ← ADD THIS
],
```

### Benefits

1. **Active Container Detection**  
   Use `browser.contextualIdentities.query()` to list all containers instead of passive detection.

2. **Event-Based Container Tracking**  
   Listen to `contextualIdentities.onCreated`, `onRemoved`, `onUpdated` events for real-time sync.

3. **Programmatic Container Selection**  
   Allow users to create Quick Tabs in specific containers from Manager Panel.

4. **Container Metadata in Manager**  
   Display container name, color, and icon in Manager Panel groupings.

### Implementation Example

```javascript
// In background.js
browser.contextualIdentities.onCreated.addListener(async (changeInfo) => {
  console.log(`[Background] New container created: ${changeInfo.contextualIdentity.name}`);
  
  // Initialize empty Quick Tab state for new container
  const existingState = await browser.storage.local.get('quick_tabs_state_v2');
  // ... add container entry
});

// In Manager Panel UI
async function displayContainers() {
  const containers = await browser.contextualIdentities.query({});
  
  containers.forEach(container => {
    const section = document.createElement('div');
    section.className = 'container-section';
    section.style.borderLeft = `4px solid ${container.colorCode}`;
    section.innerHTML = `
      <h3>${container.icon} ${container.name}</h3>
      <!-- Quick Tabs for this container -->
    `;
    managerPanel.appendChild(section);
  });
}
```

### Acceptance Criteria

- [ ] `contextualIdentities` added to `permissions` array
- [ ] Extension can call `browser.contextualIdentities.query()` without errors
- [ ] Manager Panel displays container names with colors (future feature)
- [ ] Container creation/deletion events are logged in background console (future feature)

---

## Change 4: Remove `state-manager.js` from `web_accessible_resources`

### Security Issue

**Current Configuration:**
```json
"web_accessible_resources": ["state-manager.js"],
```

**Risk:**  
Any web page can fetch `state-manager.js` using:
```javascript
const url = chrome.runtime.getURL('state-manager.js');
const response = await fetch(url);
const code = await response.text();
// Attacker can read Quick Tab state management logic
```

**Why This is Bad:**
- Exposes Quick Tab state structure to malicious pages
- Reveals storage keys and data format
- Could enable fingerprinting or privacy attacks
- Violates principle of least privilege

### Solution

Remove `state-manager.js` from `web_accessible_resources`:

```json
"web_accessible_resources": [],
```

### Why This Won't Break Anything

**Current Usage:**  
`state-manager.js` is imported as ES module in `background.js`:
```javascript
import { QuickTabStateManager } from './state-manager.js';
```

**Key Point:**  
ES module imports in extension scripts do **not** require `web_accessible_resources` declaration. This directive only applies to files that need to be fetched by web pages or content scripts via `chrome.runtime.getURL()`.

**Content scripts** communicate with state manager via **message passing** to background script, not direct import.

### Acceptance Criteria

- [ ] `web_accessible_resources` set to empty array `[]`
- [ ] Extension loads without errors
- [ ] Background script successfully imports `state-manager.js`
- [ ] Web pages **cannot** fetch `state-manager.js` (returns 404 or permission error)
- [ ] Quick Tab operations (create, move, resize) still work correctly

---

## Updated `manifest.json` (Complete)

```json
{
  "manifest_version": 2,
  "name": "Copy URL on Hover Custom",
  "version": "1.6.3.6",
  "description": "Copy URLs or link text while hovering over links. Enhanced Quick Tabs with solo/mute visibility control, navigation, minimize, and sidebar manager.",

  "permissions": [
    "storage",
    "tabs",
    "webRequest",
    "webRequestBlocking",
    "<all_urls>",
    "cookies",
    "downloads",
    "unlimitedStorage",      // NEW: Prevents storage quota errors
    "sessions",              // NEW: Enables crash recovery and tab history
    "contextualIdentities"   // NEW: Better container API integration
  ],

  "commands": {
    "toggle-quick-tabs-manager": {
      "suggested_key": {
        "default": "Ctrl+Alt+Z"
      },
      "description": "Open Quick Tabs Manager in sidebar"
    },
    "_execute_sidebar_action": {
      "suggested_key": {
        "default": "Alt+Shift+S"
      },
      "description": "Toggle sidebar (Settings/Manager)"
    }
  },

  "browser_action": {
    "default_title": "Copy URL on Hover Settings",
    "default_icon": "icons/icon.png"
  },

  "sidebar_action": {
    "default_panel": "sidebar/settings.html",
    "default_title": "Copy URL Settings & Quick Tabs",
    "default_icon": "icons/icon.png"
  },

  "options_ui": {
    "page": "options_page.html",
    "open_in_tab": true
  },

  "background": {
    "scripts": [
      "dist/browser-polyfill.min.js",
      "dist/background.js"
    ]
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "dist/browser-polyfill.min.js",
        "dist/content.js"
      ],
      "run_at": "document_end",
      "all_frames": false
    }
  ],

  "web_accessible_resources": [],  // REMOVED: state-manager.js (security fix)

  "icons": {
    "96": "icons/icon.png"
  },

  "browser_specific_settings": {
    "gecko": {
      "id": "copy-url-hover@chunkynosher.github.io",
      "update_url": "https://raw.githubusercontent.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/main/updates.json"
    }
  }
}
```

---

## Testing Plan

### Phase 1: Immediate (High Priority)

1. **Test `unlimitedStorage`**
   - Create 100+ Quick Tabs with complex state
   - Verify no `QuotaExceededError` in console
   - Restart browser, verify all Quick Tabs persist
   - Monitor storage usage in `about:debugging#/runtime/this-firefox`

2. **Test Security Fix**
   - Remove `state-manager.js` from `web_accessible_resources`
   - Verify extension loads without errors
   - Test Quick Tab operations (create, move, resize)
   - Attempt to fetch `state-manager.js` from web page console (should fail)

### Phase 2: Short-Term (Medium Priority)

3. **Test `sessions` Permission**
   - Close Quick Tab, call `browser.sessions.getRecentlyClosed()`
   - Verify Quick Tab's origin tab appears in sessions list
   - Force-close browser, reopen, verify sessions API works

4. **Test `contextualIdentities` Permission**
   - Call `browser.contextualIdentities.query()` from background console
   - Verify all Firefox Containers are returned
   - Create Quick Tab in "Personal" container
   - Verify `cookieStoreId` matches container ID

---

## Implementation Order

1. **Immediate:** Add `unlimitedStorage` + remove `state-manager.js` from `web_accessible_resources`
2. **Short-term:** Add `sessions` permission
3. **Future:** Add `contextualIdentities` permission when implementing container-specific features

---

## User-Facing Documentation

Update README with permissions explanation:

```markdown
## Permissions Explained

- **unlimitedStorage**: Allows unlimited Quick Tab state storage (no 5MB limit)
- **sessions**: Enables crash recovery and "undo close Quick Tab" features
- **contextualIdentities**: Integrates with Firefox Multi-Account Containers
```

---

## References

- [Mozilla: Declare Permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions)
- [Chrome: unlimitedStorage Permission](https://developer.chrome.com/docs/extensions/reference/permissions-list#unlimitedstorage)
- [Firefox: contextualIdentities API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities)
- [Browser Sessions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sessions)

---

**Priority:** Implement `unlimitedStorage` and security fix **immediately** to prevent data loss and security issues. Other permissions can be added incrementally.
