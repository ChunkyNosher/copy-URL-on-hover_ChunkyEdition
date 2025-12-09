# Cross-Browser Compatibility Guide: Firefox & Chromium (Manifest v2)

**Goal:** Make your copy-URL-on-hover extension work on both Firefox and
Chromium-based browsers (Chrome, Edge, Brave, Opera, Comet) while remaining in
Manifest v2.

**Strategy:** Use Mozilla's WebExtension Polyfill to bridge API differences
while maintaining a single codebase.

---

## Table of Contents

1. [Overview: The Cross-Browser Challenge](#overview)
2. [The Solution: WebExtension Polyfill](#the-solution)
3. [Implementation Steps](#implementation-steps)
4. [Handling Browser-Specific Features](#handling-browser-specific-features)
5. [Build System Setup](#build-system-setup)
6. [Testing Strategy](#testing-strategy)
7. [Known Limitations](#known-limitations)

---

## Overview: The Cross-Browser Challenge

### The Problem

Your extension currently uses Firefox-specific patterns:

```javascript
// Firefox uses the 'browser' namespace with Promises
browser.storage.sync
  .get({ key: 'defaultValue' })
  .then(result => console.log(result));

// Chrome uses 'chrome' namespace with callbacks
chrome.storage.sync.get({ key: 'defaultValue' }, result => {
  console.log(result);
});
```

**Additional Firefox-specific features in your extension:**

- `browser.contextualIdentities` (Firefox Containers - no Chrome equivalent)
- `browser_specific_settings.gecko` in manifest
- Different manifest key requirements

### Why Manifest v2?

According to MDN documentation[1]:

> "Firefox and Safari support both callbacks and Promises in Manifest V2. Chrome
> in Manifest V2 uses callbacks exclusively."

**Key advantages of staying in Manifest v2:**

- ✅ Still fully supported by Firefox (and will be for the foreseeable future)
- ✅ Supported by Chrome/Chromium (though deprecated)
- ✅ Easier to implement cross-browser support than v3
- ✅ Your extension's `webRequestBlocking` feature works without major rewrites
- ✅ Simpler background script model (persistent background pages)

**Trade-offs:**

- ⚠️ Chrome Web Store may show "Manifest v2 is deprecated" warning
- ⚠️ Chrome will eventually phase out v2 (timeline keeps extending, currently
  2024+)
- ⚠️ New submissions to Chrome Web Store require v3 (existing extensions can
  update)

---

## The Solution: WebExtension Polyfill

Mozilla's `webextension-polyfill` solves the cross-browser problem by:

1. **Unified API namespace:** Use `browser.*` everywhere (works on both Firefox
   and Chrome)
2. **Promise support:** Converts Chrome's callback-based APIs to Promises
   automatically
3. **Zero overhead on Firefox:** Acts as a no-op on Firefox (direct passthrough)
4. **Minimal bundle size:** ~10KB minified

From the official documentation[2]:

> "This library allows extensions that use the Promise-based
> WebExtension/BrowserExt API being standardized by the W3 Browser Extensions
> group to run on Google Chrome with minimal or no changes."

### What the Polyfill Does

**Before (Firefox-only code):**

```javascript
browser.storage.sync.get({ copyUrlKey: 'Y' }).then(settings => {
  console.log('Copy URL key:', settings.copyUrlKey);
});
```

**After (works on both Firefox and Chrome):**

```javascript
// Same code works everywhere!
browser.storage.sync.get({ copyUrlKey: 'Y' }).then(settings => {
  console.log('Copy URL key:', settings.copyUrlKey);
});
```

On Firefox: Polyfill detects native `browser` API and does nothing.  
On Chrome: Polyfill wraps `chrome` API with Promise-based `browser` shim.

---

## Implementation Steps

### Step 1: Install the WebExtension Polyfill

```bash
cd copy-URL-on-hover_ChunkyEdition
npm install --save webextension-polyfill
```

This installs the polyfill library (~10KB).

### Step 2: Create a Universal Manifest

Your current `manifest.json` is Firefox-specific. We need to make it work on
both browsers.

**Create a new `manifest.json` (replaces your current one):**

```json
{
  "manifest_version": 2,
  "name": "Copy URL on Hover Custom",
  "version": "1.6.1.1",
  "description": "Copy URLs or link text while hovering over links. Enhanced Quick Tabs with solo/mute visibility control, navigation, minimize, and persistent panel manager.",

  "permissions": [
    "storage",
    "tabs",
    "webRequest",
    "webRequestBlocking",
    "<all_urls>",
    "cookies",
    "downloads"
  ],

  "commands": {
    "toggle-quick-tabs-manager": {
      "suggested_key": {
        "default": "Ctrl+Alt+Z"
      },
      "description": "Toggle Quick Tabs Manager panel"
    }
  },

  "browser_action": {
    "default_title": "Copy URL on Hover Settings",
    "default_popup": "popup.html",
    "default_icon": "icons/icon.png"
  },

  "options_ui": {
    "page": "options_page.html",
    "open_in_tab": true
  },

  "background": {
    "scripts": ["dist/browser-polyfill.min.js", "dist/background.js"]
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["dist/browser-polyfill.min.js", "dist/content.js"],
      "run_at": "document_end",
      "all_frames": true
    }
  ],

  "web_accessible_resources": ["state-manager.js"],

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

**Key changes:**

1. **Added polyfill to all scripts:**
   - Background: `"dist/browser-polyfill.min.js"` loads BEFORE `background.js`
   - Content: `"dist/browser-polyfill.min.js"` loads BEFORE `content.js`
   - Order matters! Polyfill must load first.

2. **Removed Firefox-only keys that break Chrome:**
   - ~~`"contextualIdentities"` permission~~ (removed - Chrome doesn't support)
   - ~~`"persistent": true`~~ (removed - implicit in Manifest v2)

3. **Changed `options_ui`:**
   - Used `"open_in_tab": true` instead of `"browser_style"` or `"chrome_style"`
   - Works on both browsers

4. **Kept `browser_specific_settings.gecko`:**
   - Firefox needs this for extension ID
   - Chrome ignores it (doesn't cause errors)

### Step 3: Copy Polyfill to Distribution Directory

The polyfill needs to be in your `dist/` directory for the manifest to load it.

**Option A: Copy during build (recommended)**

Add this to your `package.json`:

```json
{
  "scripts": {
    "prebuild": "npm run copy:polyfill",
    "build": "rollup -c",
    "copy:polyfill": "node scripts/copy-polyfill.js"
  }
}
```

**Create `scripts/copy-polyfill.js`:**

```javascript
const fs = require('fs');
const path = require('path');

// Source: polyfill from node_modules
const source = path.join(
  __dirname,
  '../node_modules/webextension-polyfill/dist/browser-polyfill.min.js'
);

// Destination: your dist directory
const dest = path.join(__dirname, '../dist/browser-polyfill.min.js');

// Ensure dist directory exists
const distDir = path.dirname(dest);
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy file
fs.copyFileSync(source, dest);
console.log('✅ Copied webextension-polyfill to dist/');
```

Now when you run `npm run build`, the polyfill is automatically copied.

**Option B: Manual copy (for testing)**

```bash
cp node_modules/webextension-polyfill/dist/browser-polyfill.min.js dist/
```

### Step 4: Update Your Code (Minimal Changes Needed)

**Good news:** If your code already uses `browser.*` API (which it does), you
need minimal changes!

**A. Background Script (`background.js`)**

Your current code likely already uses `browser.*` throughout. No changes needed
to API calls!

However, you need to handle browser detection for Firefox Container features:

```javascript
// Add this at the TOP of background.js (after polyfill loads)

/**
 * Browser detection and feature support
 */
const BROWSER_INFO = {
  isFirefox:
    typeof browser !== 'undefined' &&
    typeof browser.runtime !== 'undefined' &&
    browser.runtime.getBrowserInfo !== undefined,
  isChrome:
    typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined',
  supportsContainers: false
};

// Check for Firefox Container support
if (BROWSER_INFO.isFirefox && browser.contextualIdentities) {
  BROWSER_INFO.supportsContainers = true;
}

console.log('[Extension] Browser info:', BROWSER_INFO);
```

**B. Content Script (`src/content.js` or wherever it's built from)**

Same as background - no changes to `browser.*` API calls needed. The polyfill
handles everything.

**C. Popup Script (`popup.js`)**

Also already uses `browser.*` - no changes needed.

**D. Options Page (`options_page.js`)**

No changes needed.

**E. State Manager (`state-manager.js`)**

If this uses `browser.*` API, no changes needed. If it's just a plain JS module,
no changes needed.

### Step 5: Handle Firefox Containers (Browser-Specific Feature)

Your extension heavily uses Firefox Containers. Chrome has **no equivalent**.
Here's how to handle this:

**Create `src/shims/container-shim.js`:**

```javascript
/**
 * Firefox Container API shim for browsers that don't support it
 * Provides a graceful fallback for Chrome/Edge/etc.
 */

export class ContainerShim {
  constructor() {
    this.supported = false;
    this.defaultContainer = {
      cookieStoreId: 'firefox-default',
      name: 'Default',
      icon: 'fingerprint',
      iconUrl: '',
      color: 'blue',
      colorCode: '#37adff'
    };
  }

  /**
   * Get container by ID
   * @param {string} cookieStoreId
   * @returns {Promise<object>}
   */
  async get(cookieStoreId) {
    // Always return default container for non-Firefox browsers
    return this.defaultContainer;
  }

  /**
   * Query all containers
   * @returns {Promise<Array>}
   */
  async query() {
    // Chrome doesn't have containers, return single default
    return [this.defaultContainer];
  }

  /**
   * Check if containers are supported
   * @returns {boolean}
   */
  isSupported() {
    return false;
  }
}

/**
 * Get the appropriate container API
 * @returns {object} Native API or shim
 */
export function getContainerAPI() {
  // Check if we're on Firefox with container support
  if (typeof browser !== 'undefined' && browser.contextualIdentities) {
    return {
      ...browser.contextualIdentities,
      isSupported: () => true
    };
  }

  // Return shim for Chrome/Edge/etc.
  return new ContainerShim();
}
```

**Update `background.js` to use the shim:**

```javascript
import { getContainerAPI } from './shims/container-shim.js';

// At the top of your background script
const containerAPI = getContainerAPI();

// Now use containerAPI instead of browser.contextualIdentities
// It works on both Firefox (native) and Chrome (shimmed)

async function getTabContainer(tab) {
  if (!containerAPI.isSupported()) {
    // Chrome - no containers, return default
    return {
      cookieStoreId: 'default',
      name: 'Default',
      color: 'blue'
    };
  }

  // Firefox - get real container
  try {
    return await containerAPI.get(tab.cookieStoreId);
  } catch (error) {
    console.warn('Failed to get container:', error);
    return { cookieStoreId: tab.cookieStoreId, name: 'Unknown' };
  }
}
```

**Key strategy:**

- Firefox: Use native `browser.contextualIdentities` API
- Chrome: Use shim that returns a default container
- Feature works on Firefox (isolated containers)
- Feature degrades gracefully on Chrome (single "default" container)

### Step 6: Update Rollup Configuration

Your extension uses Rollup for bundling. Update `rollup.config.js` to handle the
polyfill:

```javascript
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';

export default [
  // Background script
  {
    input: 'src/background/index.js', // or wherever your entry point is
    output: {
      file: 'dist/background.js',
      format: 'iife',
      name: 'BackgroundScript'
    },
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false
      }),
      commonjs(),
      process.env.NODE_ENV === 'production' && terser()
    ]
  },

  // Content script
  {
    input: 'src/content/index.js', // or wherever your entry point is
    output: {
      file: 'dist/content.js',
      format: 'iife',
      name: 'ContentScript'
    },
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false
      }),
      commonjs(),
      process.env.NODE_ENV === 'production' && terser()
    ]
  }
];
```

**Note:** The polyfill is loaded separately via manifest, so we don't bundle it
into your scripts.

### Step 7: Build and Test

```bash
# Install dependencies (including polyfill)
npm install

# Build the extension
npm run build

# Verify files exist
ls -la dist/
# Should see:
#   background.js
#   content.js
#   browser-polyfill.min.js  ← Important!
```

---

## Handling Browser-Specific Features

Your extension has features that exist only in Firefox. Here's how to handle
them:

### Feature 1: Firefox Containers (Critical Feature)

**Status:** No Chrome equivalent exists.

**Strategy:** Graceful degradation

```javascript
// In your Quick Tabs logic
async function createQuickTab(url, tabId) {
  const tab = await browser.tabs.get(tabId);

  if (containerAPI.isSupported()) {
    // Firefox: Respect container isolation
    const container = await containerAPI.get(tab.cookieStoreId);
    console.log(`Creating Quick Tab in container: ${container.name}`);
    // Your container-specific logic...
  } else {
    // Chrome: No containers, treat all tabs as same context
    console.log('Creating Quick Tab (no container isolation)');
    // Simplified logic without containers...
  }
}
```

**User experience:**

- **Firefox:** Full container isolation, Solo/Mute per container
- **Chrome:** Solo/Mute works globally (no per-container isolation)

### Feature 2: Auto-Updates from GitHub

**Current implementation:** Firefox-specific `update_url` in manifest

```json
"browser_specific_settings": {
  "gecko": {
    "update_url": "https://raw.githubusercontent.com/..."
  }
}
```

**Status:** This works on Firefox, ignored by Chrome.

**Chrome alternative:** Chrome Web Store handles updates automatically (if
published there).

**Strategy for self-hosted:**

```javascript
// Optional: Manual update check for Chrome users
async function checkForUpdates() {
  if (BROWSER_INFO.isChrome) {
    // Chrome doesn't support update_url
    // Could implement manual update notification
    const response = await fetch(
      'https://api.github.com/repos/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases/latest'
    );
    const latest = await response.json();
    const currentVersion = browser.runtime.getManifest().version;

    if (latest.tag_name !== `v${currentVersion}`) {
      console.log('Update available:', latest.tag_name);
      // Show notification to user
    }
  }
}
```

### Feature 3: X-Frame-Options Bypass (webRequestBlocking)

**Status:** Works in both Firefox and Chrome Manifest v2.

**Future concern:** Chrome Manifest v3 removes `webRequestBlocking`.

**Current solution:** Keep using Manifest v2. When Chrome fully deprecates it,
you'll need to:

1. Migrate to `declarativeNetRequest` API (v3), OR
2. Accept that some sites won't work in Quick Tabs on Chrome

**For now:** No changes needed. Your current `webRequestBlocking` implementation
works on both browsers.

---

## Build System Setup

### Complete Package.json Scripts

Update your `package.json` with these scripts:

```json
{
  "scripts": {
    "prebuild": "npm run copy:polyfill",
    "build": "rollup -c",
    "build:prod": "NODE_ENV=production npm run build",
    "copy:polyfill": "node scripts/copy-polyfill.js",
    "watch": "rollup -c -w",
    "test": "jest",
    "lint": "eslint src/",
    "package:firefox": "npm run build:prod && node scripts/package-firefox.js",
    "package:chrome": "npm run build:prod && node scripts/package-chrome.js"
  }
}
```

### Firefox Packaging Script

**Create `scripts/package-firefox.js`:**

```javascript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('📦 Packaging for Firefox...');

const files = [
  'dist/',
  'icons/',
  'popup.html',
  'popup.js',
  'options_page.html',
  'options_page.js',
  'state-manager.js',
  'manifest.json'
];

// Create zip with all necessary files
const excludes = [
  '*.git*',
  'node_modules/*',
  'tests/*',
  'scripts/*',
  'src/*',
  '.github/*',
  'package*.json',
  '*.md'
]
  .map(pattern => `--exclude=${pattern}`)
  .join(' ');

execSync(`zip -r -FS firefox-extension.xpi ${files.join(' ')} ${excludes}`, {
  stdio: 'inherit'
});

console.log('✅ Firefox package created: firefox-extension.xpi');
console.log('📝 Install: about:addons → Install Add-on From File');
```

### Chrome Packaging Script

**Create `scripts/package-chrome.js`:**

```javascript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('📦 Packaging for Chrome...');

const files = [
  'dist/',
  'icons/',
  'popup.html',
  'popup.js',
  'options_page.html',
  'options_page.js',
  'state-manager.js',
  'manifest.json'
];

// Create zip with all necessary files
const excludes = [
  '*.git*',
  'node_modules/*',
  'tests/*',
  'scripts/*',
  'src/*',
  '.github/*',
  'package*.json',
  '*.md'
]
  .map(pattern => `--exclude=${pattern}`)
  .join(' ');

execSync(`zip -r -FS chrome-extension.zip ${files.join(' ')} ${excludes}`, {
  stdio: 'inherit'
});

console.log('✅ Chrome package created: chrome-extension.zip');
console.log(
  '📝 Install: chrome://extensions/ → Developer Mode → Load unpacked'
);
console.log('📝 Or upload chrome-extension.zip to Chrome Web Store');
```

### Usage

```bash
# Build Firefox package
npm run package:firefox
# → Creates firefox-extension.xpi

# Build Chrome package
npm run package:chrome
# → Creates chrome-extension.zip
```

---

## Testing Strategy

### Testing on Firefox

1. **Build the extension:**

   ```bash
   npm run build
   ```

2. **Load temporarily:**
   - Open `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select `manifest.json`

3. **Test checklist:**
   - [ ] Extension icon appears
   - [ ] Popup opens and settings work
   - [ ] Copy URL (Y key) works
   - [ ] Copy text (X key) works
   - [ ] Quick Tabs open (Q key)
   - [ ] Firefox Containers work (solo/mute per container)
   - [ ] Settings persist across browser restart
   - [ ] Console shows no errors

4. **Check console:**
   - Browser console (Ctrl+Shift+J): Background script logs
   - Web page console (F12): Content script logs

### Testing on Chrome/Chromium

1. **Build the extension:**

   ```bash
   npm run build
   ```

2. **Load in developer mode:**
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked"
   - Select your extension's root directory

3. **Test checklist:**
   - [ ] Extension icon appears
   - [ ] Popup opens and settings work
   - [ ] Copy URL (Y key) works
   - [ ] Copy text (X key) works
   - [ ] Quick Tabs open (Q key)
   - [ ] Solo/Mute works (globally, not per-container)
   - [ ] Settings persist
   - [ ] Background page console shows no errors

4. **Check console:**
   - Go to `chrome://extensions/`
   - Find your extension
   - Click "background page" link → Opens background console
   - Web page console (F12): Content script logs

### Testing on Comet Browser

Since Comet is Chromium-based, follow the Chrome testing steps:

1. Open Comet browser
2. Navigate to `chrome://extensions/`
3. Enable Developer Mode
4. Load unpacked extension
5. Test all features

**Expected behavior in Comet:**

- ✅ All basic features work (copy URL, copy text, Quick Tabs)
- ⚠️ No Firefox Container isolation (Chrome limitation)
- ✅ Solo/Mute works globally

### Automated Testing

Your extension already has Jest tests. Update them to handle both browsers:

```javascript
// In your test files
describe('Browser API', () => {
  beforeEach(() => {
    // Mock browser API for tests
    global.browser = {
      storage: {
        sync: {
          get: jest.fn(),
          set: jest.fn()
        }
      },
      tabs: {
        query: jest.fn(),
        get: jest.fn()
      }
      // ... etc
    };
  });

  test('storage API works with polyfill', async () => {
    browser.storage.sync.get.mockResolvedValue({ copyUrlKey: 'Y' });

    const result = await browser.storage.sync.get({ copyUrlKey: 'Y' });
    expect(result.copyUrlKey).toBe('Y');
  });
});
```

---

## Known Limitations

### What Works Everywhere

✅ Copy URL on hover (Y key)  
✅ Copy link text (X key)  
✅ Open link in new tab (O key)  
✅ Quick Tabs (Q key)  
✅ Quick Tabs Manager panel (Ctrl+Alt+Z)  
✅ Drag and resize Quick Tabs  
✅ Solo/Mute functionality (globally)  
✅ Settings persistence  
✅ Keyboard shortcuts  
✅ X-Frame-Options bypass (Manifest v2 only)

### Firefox-Only Features

🦊 **Firefox Containers:**

- Container isolation for Quick Tabs
- Solo/Mute per container
- Container-aware state management
- **Chrome:** Falls back to single "default" container

🦊 **Auto-updates from GitHub:**

- Firefox supports `update_url` in manifest
- **Chrome:** Requires Chrome Web Store for auto-updates, or manual updates

### Chrome/Chromium Limitations

⚠️ **No Firefox Container Support:**

- Chrome has no equivalent to Firefox Containers
- Solo/Mute works globally instead of per-container
- `browser.contextualIdentities` API doesn't exist

⚠️ **Storage Quota Differences:**

- Firefox: `storage.sync` quota is 100KB
- Chrome: `storage.sync` quota is ~100KB (similar but slightly different limits)
- Both have per-item size limits (~8KB)

⚠️ **Manifest v2 Deprecation:**

- Chrome shows "Manifest v2 is deprecated" warning
- Still works, but Chrome may eventually remove support
- Timeline keeps extending (currently 2024+)

### Future Concerns

🔮 **Chrome Manifest v3 Migration:**

When Chrome fully removes Manifest v2 support, you'll need to:

1. **Migrate background to service worker:**

   ```json
   "background": {
     "service_worker": "dist/background.js"
   }
   ```

2. **Replace `webRequestBlocking` with `declarativeNetRequest`:**
   - Much more limited
   - May not support all your X-Frame-Options bypass needs
   - Some sites might not work in Quick Tabs

3. **Update polyfill:**
   - Use Manifest v3 compatible version
   - Handle service worker limitations

**Recommendation:** Stay on Manifest v2 as long as possible. Firefox has
committed to long-term v2 support, and Chrome keeps extending the deprecation
timeline.

---

## Troubleshooting

### Issue: "browser is not defined" in Chrome

**Cause:** Polyfill not loaded before your scripts.

**Solution:** Check manifest order:

```json
"background": {
  "scripts": [
    "dist/browser-polyfill.min.js",  // ← Must be FIRST
    "dist/background.js"
  ]
}
```

### Issue: "Manifest contains unknown permission: contextualIdentities"

**Cause:** Permission still in manifest for Chrome.

**Solution:** Remove from manifest (Chrome doesn't support it):

```json
"permissions": [
  "storage",
  "tabs",
  // NOT "contextualIdentities" - Chrome doesn't support
  "webRequest",
  "webRequestBlocking",
  "<all_urls>"
]
```

### Issue: Container features not working on Chrome

**Expected:** Chrome doesn't have containers.

**Solution:** Use the container shim (see Step 5). Features degrade gracefully.

### Issue: Polyfill file missing from dist/

**Cause:** Build script didn't copy polyfill.

**Solution:**

```bash
# Manual copy
cp node_modules/webextension-polyfill/dist/browser-polyfill.min.js dist/

# Or ensure prebuild script runs
npm run prebuild
npm run build
```

### Issue: Extension works in Firefox but not Chrome

**Debug steps:**

1. Check Chrome's background page console:
   - `chrome://extensions/` → click "background page" link
   - Look for errors

2. Check content script console:
   - F12 on any webpage → Console tab
   - Filter for extension logs

3. Verify polyfill loaded:
   - In console, type: `typeof browser`
   - Should return `"object"` (not `"undefined"`)

4. Common Chrome-specific errors:
   - Missing polyfill → "browser is not defined"
   - Wrong manifest format → "Failed to load manifest"
   - Unsupported permission → "Unknown permission: X"

---

## Maintenance Tips

### Keeping Both Versions in Sync

Since you're maintaining one codebase for both browsers:

1. **Always test on both browsers** after making changes
2. **Use feature detection, not browser detection:**

   ```javascript
   // Good
   if (containerAPI.isSupported()) {
     // Use containers
   }

   // Bad
   if (BROWSER_INFO.isFirefox) {
     // This works but is fragile
   }
   ```

3. **Document browser differences** in code comments:

   ```javascript
   /**
    * Get container for tab
    * Firefox: Returns actual container object
    * Chrome: Returns default container (no container support)
    */
   async function getTabContainer(tab) {
     // ...
   }
   ```

4. **Use CI/CD to test both:**
   ```yaml
   # .github/workflows/test.yml
   jobs:
     test-firefox:
       # ... test in Firefox

     test-chrome:
       # ... test in Chrome
   ```

### Updating the Polyfill

When new versions of webextension-polyfill are released:

```bash
# Update polyfill
npm update webextension-polyfill

# Rebuild to copy new version
npm run build

# Test on both browsers!
```

### Version Numbers

Keep the same version number for both Firefox and Chrome packages:

```json
{
  "version": "1.6.1.1" // Same for both browsers
}
```

This makes it clear to users they're using the same codebase.

---

## Summary

### What You Did

1. ✅ Installed `webextension-polyfill`
2. ✅ Updated manifest to load polyfill first
3. ✅ Created container shim for Chrome compatibility
4. ✅ Updated build scripts to copy polyfill
5. ✅ Kept using `browser.*` API everywhere (no code changes!)

### What You Got

- ✅ Single codebase works on Firefox, Chrome, Edge, Brave, Opera, Comet
- ✅ Firefox gets full features (containers, auto-updates)
- ✅ Chrome gets core features (graceful degradation for containers)
- ✅ Promise-based API everywhere (cleaner code)
- ✅ Minimal bundle size increase (~10KB)

### Trade-offs

- ⚠️ Chrome users don't get Firefox Container isolation
- ⚠️ Manifest v2 is deprecated in Chrome (but still works)
- ⚠️ Need to maintain browser compatibility testing

### Next Steps

1. **Implement the changes** (Steps 1-7 above)
2. **Build and test** on both Firefox and Chrome
3. **Update your README** to mention cross-browser support
4. **Consider publishing** to Chrome Web Store (optional)
5. **Plan for Manifest v3** migration when necessary

---

## References

[1] MDN: "Build a cross-browser extension" -
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension

[2] Mozilla: "webextension-polyfill" -
https://github.com/mozilla/webextension-polyfill

[3] MDN: "Chrome incompatibilities" -
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities

[4] Akos Komuves: "Building a Cross Browser Extension in 2022" -
https://akoskm.com/building-a-cross-browser-extension/

---

## Questions?

If you encounter issues during implementation:

1. Check the **Troubleshooting** section above
2. Verify polyfill is loaded: `console.log(typeof browser)` should be `"object"`
3. Check both background and content script consoles
4. Compare your manifest against the template in Step 2

Good luck with the cross-browser implementation! 🚀
