# Playwright MCP Test Bridge Failure - Manifest V2 Solutions

**Repository**: copy-URL-on-hover_ChunkyEdition  
**Issue**: Test Bridge not accessible in page context during Playwright tests  
**Root Cause**: Content script injection working, but Test Bridge not exposing
to `window` object  
**Priority**: CRITICAL - Blocks all autonomous browser extension testing  
**Constraint**: MUST remain Manifest V2 (WebRequest API dependency)  
**Date**: November 23, 2025

---

## Executive Summary

**THE PROBLEM**: Playwright MCP servers ARE working and browser IS launching
with the extension loaded, BUT the Test Bridge
(`window.__COPILOT_TEST_BRIDGE__`) is NOT being exposed to the page context. All
42+ tests fail immediately because they cannot access the bridge API.

**THE ROOT CAUSE**: The content script is running, but the injected Test Bridge
Page Proxy script is either:

1. Not executing in the correct page context (Main vs Isolated)
2. Executing but being blocked by CSP (Content Security Policy)
3. Timing out before the page loads
4. Not properly injecting into the DOM

**CRITICAL CONSTRAINT**: Extension MUST remain Manifest V2 because the
WebRequest API functionality does not work properly in Manifest V3. All
solutions must be V2-compatible.

**IMPACT**:

- Playwright MCP Chrome server: ✅ CONNECTED AND WORKING
- Playwright MCP Firefox server: ✅ CONNECTED AND WORKING
- Browser launching: ✅ SUCCESS (Chromium with extension)
- Extension loading: ✅ SUCCESS (dist folder loaded)
- Content script: ✅ INJECTED (logs show execution)
- **Test Bridge exposure: ❌ FAILURE**
  (`window.__COPILOT_TEST_BRIDGE__ === undefined`)

---

## Evidence from Logs

### 1. MCP Servers Successfully Connected

```
2025-11-23T024807.4351668Z MCP client for playwright-firefox connected, took 7135ms
2025-11-23T024807.4359947Z Started MCP client for playwright-firefox

2025-11-23T024807.4704470Z MCP client for playwright-chrome connected, took 7183ms
2025-11-23T024807.4718288Z Started MCP client for playwright-chrome

2025-11-23T024807.5073103Z MCP client for playwright connected, took 7259ms
2025-11-23T024807.5077723Z Started MCP client for playwright
```

**Analysis**: All three Playwright MCP servers (chrome, firefox, and generic)
connected successfully. No browser launch failures. This is DIFFERENT from the
previous issue where browsers weren't installed.

### 2. Browsers Installed Successfully

The logs show NO "Executable doesn't exist" errors. Previous fix (installing
Playwright browsers) IS working.

### 3. Test Execution Shows Extension Loading

```
2025-11-23T030302.2613505Z Fixture Using launchPersistentContext required for extensions
2025-11-23T030302.2614180Z Fixture Extension path homerunnerworkcopy-URL-on-hoverChunkyEditioncopy-URL-on-hoverChunkyEditiondist
2025-11-23T030302.2614661Z Fixture Temp directory tmpplaywright-chrome-wXATxG
2025-11-23T030302.2615072Z Fixture Chromium persistent context created with extension
```

**Analysis**: Browser launches successfully with the extension from `dist`
folder. No errors about missing files or failed context creation.

### 4. Test Bridge Verification FAILS

```
2025-11-23T030335.4112151Z Error expectreceived.toBeexpected Object.is equality
2025-11-23T030335.4113133Z
2025-11-23T030335.4113597Z Expected true
2025-11-23T030335.4114165Z Received false
...
2025-11-23T030335.4116444Z 32 expecthasBridge.toBetrue
```

**Test code shows**:

```javascript
const hasBridge = await page.evaluate(() => {
  return typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined';
});
// hasBridge === false ❌
```

**Analysis**: The bridge object is NOT present in the page's window object. The
test can execute JavaScript in the page, but `window.__COPILOT_TEST_BRIDGE__` is
undefined.

### 5. Content Script IS Being Injected

From earlier examination of `dist/content.js`:

```javascript
// TEST BRIDGE PAGE INJECTION
function injectTestBridge() {
  function doInject() {
    const script = document.createElement('script');
    script.textContent = `/* Test Bridge Page Proxy code */`;
    document.head.appendChild(script);
    script.remove();
    console.log(
      'Content Script: Test bridge page proxy injected at',
      document.readyState
    );
  }
  // ...
}
```

The injection code IS present in the built extension.

---

## Root Cause Analysis

### Problem: Script Injection Context Mismatch

**Firefox/Chrome Extension Content Scripts run in an ISOLATED WORLD**, separate
from the actual page's JavaScript context. When the content script does:

```javascript
const script = document.createElement('script');
script.textContent = `window.__COPILOT_TEST_BRIDGE__ = ...`;
document.head.appendChild(script);
```

The script element **SHOULD** execute in the MAIN world (page context), exposing
`window.__COPILOT_TEST_BRIDGE__` to Playwright's `page.evaluate()`.

**But it's not working. Why?**

### Potential Root Causes (Priority Order - Manifest V2 Context)

#### 1. Content Security Policy (CSP) Blocking Inline Scripts

**Symptom**: The `<script>` tag with `textContent` is being blocked by the
page's CSP.

**Evidence**:

- Data URLs (`data:text/html,...`) have very restrictive default CSP
- The test uses a data URL: `await page.goto('data:text/html,<html>...')`
- CSP blocks `script.textContent` injection but allows `script.src`

**Why this matters**: From the content script code:

```javascript
script.textContent = `/* entire test bridge proxy code */`;
```

If the page has CSP `script-src 'self'` or similar, this inline script will be
SILENTLY BLOCKED.

**Manifest V2 Solution**: Use `script.src` with a `blob:` URL (V2 compatible).

#### 2. Timing Issue: Script Runs Before DOM Ready

**Symptom**: The content script's `run_at: document_end` may fire before the
page's `<head>` exists.

**Evidence**:

```javascript
if (document.readyState !== 'loading') {
  doInject();
} else {
  document.addEventListener('DOMContentLoaded', doInject);
}
```

This SHOULD handle timing, but on fast-loading data URLs, there may be a race
condition.

**Manifest V2 Solution**: Add defensive polling with timeout.

#### 3. Manifest V2 `all_frames: false` Limitation

**Evidence from manifest.json**:

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["content.js"],
  "run_at": "document_end",
  "all_frames": false
}]
```

**Why this matters**: With `all_frames: false`, the content script only runs in
the TOP frame. If Playwright's test harness creates an iframe or nested context,
the content script won't execute there.

**Manifest V2 Solution**: Change to `"all_frames": true`.

#### 4. `script.remove()` Executing Too Early

**Evidence**:

```javascript
document.head.appendChild(script);
script.remove(); // Removes script immediately
```

**Why this matters**: If the script hasn't finished parsing/executing when
`remove()` is called, it may not fully initialize
`window.__COPILOT_TEST_BRIDGE__`.

**Manifest V2 Solution**: Use `script.onload` or remove the `script.remove()`
call entirely.

---

## Manifest V2 Compatible Solutions (Priority Order)

### ✅ Solution 1: Blob URL Injection (RECOMMENDED - Manifest V2)

**Problem**: Inline `script.textContent` blocked by CSP.

**Solution**: Convert script to Blob URL (100% Manifest V2 compatible).

**File**: `src/test-bridge-content-handler.js`

**Implementation**:

```javascript
/**
 * Injects the test bridge page proxy into the actual page context
 * Uses Blob URL to bypass CSP restrictions on inline scripts
 * Manifest V2 compatible
 */
function injectTestBridge() {
  // Import the page proxy code as a string
  const testBridgeProxyCode = require('./test-bridge-page-proxy.js').toString();

  /**
   * Attempts injection with retry logic
   * @param {number} attempts - Current attempt count
   */
  function attemptInject(attempts = 0) {
    // Wait for DOM to be ready
    const targetElement = document.head || document.documentElement;
    if (!targetElement) {
      if (attempts < 50) {
        // Max 500ms wait
        setTimeout(() => attemptInject(attempts + 1), 10);
        return;
      }
      console.error(
        '[CONTENT SCRIPT] Failed to inject test bridge: no DOM after 500ms'
      );
      return;
    }

    console.log('[CONTENT SCRIPT] Injecting test bridge via Blob URL');

    // Create Blob from code string
    const blob = new Blob([testBridgeProxyCode], {
      type: 'application/javascript'
    });
    const blobUrl = URL.createObjectURL(blob);

    // Create script element with blob URL
    const script = document.createElement('script');
    script.src = blobUrl; // Use src instead of textContent - bypasses CSP

    // Clean up after load
    script.onload = () => {
      URL.revokeObjectURL(blobUrl);
      console.log(
        '[CONTENT SCRIPT] Test bridge loaded successfully via Blob URL'
      );

      // Verify bridge exists
      const checkScript = document.createElement('script');
      checkScript.textContent = `
        if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
          console.log('[TEST BRIDGE] Successfully exposed to window object')
        } else {
          console.error('[TEST BRIDGE] NOT found on window object after injection')
        }
      `;
      targetElement.appendChild(checkScript);
      checkScript.remove();
    };

    script.onerror = error => {
      console.error('[CONTENT SCRIPT] Failed to load test bridge:', error);
      URL.revokeObjectURL(blobUrl);
    };

    // Inject into page
    targetElement.appendChild(script);
    // Don't remove immediately - let onload handle cleanup
  }

  // Start injection attempt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => attemptInject());
  } else {
    attemptInject();
  }
}

// Execute injection when content script loads
if (typeof browser !== 'undefined' || typeof chrome !== 'undefined') {
  injectTestBridge();
}
```

**Why this works**:

- ✅ Blob URLs bypass CSP `script-src` restrictions
- ✅ `script.src` (not `textContent`) executes in main world
- ✅ 100% Manifest V2 compatible (no V3 APIs)
- ✅ Defensive polling ensures DOM ready
- ✅ Proper cleanup via `onload`/`onerror`

### ✅ Solution 2: Alternative - Data URL (Manifest V2)

**If Blob URLs don't work for some reason**, use Data URL as fallback.

**Implementation**:

```javascript
function injectTestBridge() {
  const testBridgeProxyCode = require('./test-bridge-page-proxy.js').toString();

  function attemptInject(attempts = 0) {
    const targetElement = document.head || document.documentElement;
    if (!targetElement) {
      if (attempts < 50) {
        setTimeout(() => attemptInject(attempts + 1), 10);
        return;
      }
      console.error('[CONTENT SCRIPT] Failed to inject test bridge: no DOM');
      return;
    }

    console.log('[CONTENT SCRIPT] Injecting test bridge via Data URL');

    // Create data URL from code
    const dataUrl =
      'data:application/javascript;charset=utf-8,' +
      encodeURIComponent(testBridgeProxyCode);

    const script = document.createElement('script');
    script.src = dataUrl; // Data URL also bypasses CSP

    script.onload = () => {
      console.log('[CONTENT SCRIPT] Test bridge loaded via Data URL');
    };

    script.onerror = error => {
      console.error('[CONTENT SCRIPT] Failed to load test bridge:', error);
    };

    targetElement.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => attemptInject());
  } else {
    attemptInject();
  }
}
```

**Why this works**:

- ✅ Data URLs also bypass most CSP restrictions
- ✅ 100% Manifest V2 compatible
- ✅ No Blob API needed (older browser support)

### ✅ Solution 3: Manifest Changes (Manifest V2)

**File**: `manifest.json`

**Change 1 - Enable All Frames**:

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["content.js"],
  "run_at": "document_end",
  "all_frames": true  // ← Changed from false - V2 compatible
}]
```

**Change 2 - Verify Permissions**:

```json
"permissions": [
  "storage",
  "tabs",
  "webRequest",
  "webRequestBlocking",
  "<all_urls>"
]
```

**Why this works**:

- ✅ `all_frames: true` ensures content script runs in all contexts
- ✅ `<all_urls>` permission allows injection into any page
- ✅ All settings are Manifest V2 native

### ✅ Solution 4: Add Explicit Content Script Marker (Manifest V2)

**File**: `src/test-bridge-content-handler.js` (top of file)

**Add at the very beginning**:

```javascript
// Marker to verify content script execution
(function () {
  'use strict';

  // Set marker immediately
  const marker = document.createElement('meta');
  marker.name = 'copilot-content-script-loaded';
  marker.content = 'true';
  if (document.head) {
    document.head.appendChild(marker);
  } else {
    // If head doesn't exist yet, wait for it
    const observer = new MutationObserver(() => {
      if (document.head) {
        document.head.appendChild(marker);
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  }

  console.log('[CONTENT SCRIPT] Marker set at', new Date().toISOString());
  console.log('[CONTENT SCRIPT] URL:', window.location.href);
  console.log('[CONTENT SCRIPT] readyState:', document.readyState);
})();
```

**In tests** (verification):

```javascript
test('verify content script loads', async ({ page }) => {
  await page.goto('data:text/html,<html><head></head><body></body></html>');

  const markerExists = await page.evaluate(() => {
    const marker = document.querySelector(
      'meta[name="copilot-content-script-loaded"]'
    );
    return marker !== null && marker.content === 'true';
  });

  expect(markerExists).toBe(true);
});
```

**Why this works**:

- ✅ Verifies content script actually executes
- ✅ 100% Manifest V2 compatible
- ✅ Easy to check from tests
- ✅ No V3 APIs required

### ✅ Solution 5: Improve Page Proxy Logging (Manifest V2)

**File**: `src/test-bridge-page-proxy.js` (top of file)

**Add detailed logging**:

```javascript
(function () {
  'use strict';

  console.log('[TEST BRIDGE PAGE PROXY] Starting execution');
  console.log('[TEST BRIDGE PAGE PROXY] typeof window:', typeof window);
  console.log(
    '[TEST BRIDGE PAGE PROXY] document.readyState:',
    document.readyState
  );
  console.log('[TEST BRIDGE PAGE PROXY] location.href:', window.location.href);

  // ... rest of test bridge code ...

  // After exposing bridge
  window.__COPILOT_TEST_BRIDGE__ = {
    // ... API methods ...
  };

  console.log('[TEST BRIDGE PAGE PROXY] Bridge exposed to window');
  console.log(
    '[TEST BRIDGE PAGE PROXY] typeof window.__COPILOT_TEST_BRIDGE__:',
    typeof window.__COPILOT_TEST_BRIDGE__
  );
  console.log(
    '[TEST BRIDGE PAGE PROXY] Bridge methods:',
    Object.keys(window.__COPILOT_TEST_BRIDGE__)
  );
})();
```

**Why this works**:

- ✅ Helps diagnose exactly where injection fails
- ✅ 100% Manifest V2 compatible
- ✅ No API dependencies

### ✅ Solution 6: Test Fixture Enhancement (Manifest V2)

**File**: `tests/extension/fixtures.js`

**Add page reload after context creation**:

```javascript
// Manifest V2 compatible fixture enhancement
export const test = base.extend({
  context: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-chrome-'));

    const context = await chromium.launchPersistentContext(tmpDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`
      ]
    });

    // IMPORTANT: Reload first page to ensure content scripts activate
    // This is a known issue with extension loading in persistent contexts
    const pages = context.pages();
    if (pages.length > 0) {
      console.log(
        '[FIXTURE] Reloading initial page to activate content scripts'
      );
      await pages[0].reload({ waitUntil: 'domcontentloaded' });
      // Give extension time to initialize
      await pages[0].waitForTimeout(500);
    }

    await use(context);

    await context.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  },

  page: async ({ context }, use) => {
    const page = await context.newPage();

    // Listen for console messages (helps debugging)
    page.on('console', msg => {
      if (
        msg.text().includes('[TEST BRIDGE]') ||
        msg.text().includes('[CONTENT SCRIPT]')
      ) {
        console.log(`[BROWSER ${msg.type()}]`, msg.text());
      }
    });

    await use(page);
  }
});
```

**Why this works**:

- ✅ Forces content script activation via reload
- ✅ 100% Manifest V2 compatible
- ✅ Adds helpful console logging
- ✅ No V3 APIs

---

## Diagnostic Steps (Manifest V2 Compatible)

### Step 1: Verify Content Script Executes

**Test**:

```javascript
test('content script marker check', async ({ page }) => {
  await page.goto(
    'data:text/html,<html><head></head><body><h1>Test</h1></body></html>'
  );
  await page.waitForTimeout(1000); // Wait for content script

  const marker = await page.evaluate(() => {
    const meta = document.querySelector(
      'meta[name="copilot-content-script-loaded"]'
    );
    return meta ? meta.content : null;
  });

  console.log('Content script marker:', marker);
  expect(marker).toBe('true');
});
```

### Step 2: Check for CSP Errors

**Test**:

```javascript
test('check browser console for CSP errors', async ({ page }) => {
  const consoleMessages = [];

  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  await page.goto('data:text/html,<html><head></head><body></body></html>');
  await page.waitForTimeout(2000);

  // Check for CSP-related errors
  const cspErrors = consoleMessages.filter(
    m =>
      m.text.includes('Content Security Policy') ||
      m.text.includes('CSP') ||
      m.text.includes('refused to execute')
  );

  if (cspErrors.length > 0) {
    console.log('CSP ERRORS FOUND:');
    cspErrors.forEach(err => console.log(`  ${err.type}: ${err.text}`));
  } else {
    console.log('No CSP errors detected');
  }
});
```

### Step 3: Test with Real URL vs Data URL

**Test**:

```javascript
test('bridge availability - real URL', async ({ page }) => {
  // Test with real webpage (less restrictive CSP)
  await page.goto('https://example.com');
  await page.waitForTimeout(2000);

  const hasBridge = await page.evaluate(() => {
    return typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined';
  });

  console.log('Bridge available on real URL:', hasBridge);

  // If this works but data URL doesn't, CSP is the issue
});
```

### Step 4: Inspect Window Object

**Test**:

```javascript
test('inspect window for bridge-related keys', async ({ page }) => {
  await page.goto('data:text/html,<html><body></body></html>');
  await page.waitForTimeout(2000);

  const windowInspection = await page.evaluate(() => {
    return {
      allKeys: Object.keys(window).filter(
        k => k.includes('COPILOT') || k.includes('TEST') || k.includes('BRIDGE')
      ),
      hasCOPILOT_TEST_BRIDGE: typeof window.__COPILOT_TEST_BRIDGE__,
      windowKeys: Object.keys(window).length
    };
  });

  console.log('Window inspection:', JSON.stringify(windowInspection, null, 2));
});
```

---

## Implementation Priority (Manifest V2 Only)

| Priority | Solution                          | Effort       | Impact                    | V2 Compatible |
| -------- | --------------------------------- | ------------ | ------------------------- | ------------- |
| **1**    | Solution 1: Blob URL injection    | Low (15 min) | High - Bypasses CSP       | ✅ YES        |
| **2**    | Solution 4: Content script marker | Low (5 min)  | High - Confirms execution | ✅ YES        |
| **3**    | Solution 3: Manifest changes      | Low (2 min)  | Medium - Broader coverage | ✅ YES        |
| **4**    | Solution 5: Logging enhancement   | Low (5 min)  | Medium - Diagnostics      | ✅ YES        |
| **5**    | Solution 6: Fixture reload        | Low (10 min) | Medium - Activation fix   | ✅ YES        |
| **6**    | Solution 2: Data URL fallback     | Low (10 min) | Low - Backup option       | ✅ YES        |

**Recommended approach**: Implement Solutions 1, 3, 4, and 5 together (total ~25
minutes). All are Manifest V2 compatible and address the most likely root
causes.

**DO NOT IMPLEMENT**: Any solution mentioning `chrome.scripting.executeScript`
with `world: 'MAIN'` - this is Manifest V3 only.

---

## Expected Results After Fix

### Before Fix (Current State)

```
✓ Playwright MCP Chrome: Connected
✓ Playwright MCP Firefox: Connected
✓ Browser launches with extension
✓ Content script in manifest
✓ Manifest V2 with WebRequest API
✗ window.__COPILOT_TEST_BRIDGE__: undefined
✗ All tests fail with "Expected true, Received false"
```

### After Fix (Expected State)

```
✓ Playwright MCP Chrome: Connected
✓ Playwright MCP Firefox: Connected
✓ Browser launches with extension
✓ Content script executes (marker detected)
✓ Manifest V2 with WebRequest API preserved
✓ Test Bridge injected via Blob URL
✓ window.__COPILOT_TEST_BRIDGE__: Object with API methods
✓ Tests can call bridge.createQuickTab(), bridge.getQuickTabs(), etc.
✓ All 42+ tests execute (may pass/fail based on logic, but can RUN)
```

---

## Verification Checklist

After implementing fixes, verify:

### ✅ Content Script Execution (Manifest V2)

- [ ] Browser console shows `[CONTENT SCRIPT] Marker set` message
- [ ] `<meta name="copilot-content-script-loaded">` exists in DOM
- [ ] No errors about missing chrome.runtime or extension APIs
- [ ] Manifest remains V2 (`"manifest_version": 2`)

### ✅ Test Bridge Injection (Manifest V2)

- [ ] Browser console shows
      `[CONTENT SCRIPT] Injecting test bridge via Blob URL`
- [ ] Browser console shows `[TEST BRIDGE PAGE PROXY] Starting execution`
- [ ] Browser console shows `[TEST BRIDGE PAGE PROXY] Bridge exposed to window`
- [ ] No CSP errors in console
- [ ] `typeof window.__COPILOT_TEST_BRIDGE__ === 'object'` in tests

### ✅ Manifest V2 Compliance

- [ ] `manifest.json` still shows `"manifest_version": 2`
- [ ] `webRequest` and `webRequestBlocking` permissions present
- [ ] No V3-only APIs used (`chrome.scripting`, `chrome.action`, etc.)
- [ ] Extension still functions with WebRequest API

### ✅ API Functionality

- [ ] Can call `window.__COPILOT_TEST_BRIDGE__.createQuickTab()`
- [ ] Can call `window.__COPILOT_TEST_BRIDGE__.getQuickTabs()`
- [ ] Methods return Promises that resolve with data
- [ ] Event communication works (TESTBRIDGE_REQUEST → TESTBRIDGE_RESPONSE)

### ✅ Test Execution

- [ ] Simple bridge test passes
- [ ] At least one Quick Tab test executes
- [ ] No "Bridge not available after timeout" errors
- [ ] Tests complete within 60-second timeout

---

## Why Manifest V2 is Mandatory

**Critical Dependencies on V2 APIs:**

1. **WebRequest API** - Used for intercepting and modifying network requests
   - V2: `webRequest` and `webRequestBlocking` work synchronously
   - V3: `declarativeNetRequest` is far more limited, cannot modify headers
     dynamically
   - **Your extension likely uses this for URL manipulation**

2. **Background Page** - Persistent background context
   - V2: `background.page` or `background.scripts` stay alive
   - V3: Service Workers that can be killed anytime
   - **Test Bridge background handler requires persistent state**

3. **Content Script Injection**
   - V2: Reliable injection via `content_scripts` manifest key
   - V3: Same mechanism, BUT `chrome.scripting` is often needed for dynamic
     injection
   - **Your current setup works in V2**

**Migration to V3 would require:**

- Rewriting WebRequest logic to use declarativeNetRequest
- Converting background page to service worker
- Handling service worker lifecycle (wake/sleep)
- Testing all functionality in new paradigm
- **Estimated effort: 20-40 hours of work**

**Since V2 works and your extension requires WebRequest, staying on V2 is the
correct choice.**

---

## Additional Context

### Why Playwright MCP is NOT the Problem

The logs show:

```
Started MCP client for playwright-chrome
Tool browsernavigate added to tools list
Tool browserevaluate added to tools list
```

All Playwright MCP tools are available and the servers are connected. The issue
is STRICTLY with the extension's internal test infrastructure, NOT with
Playwright MCP itself.

### Why This Blocks Testing

Without `window.__COPILOT_TEST_BRIDGE__`, tests cannot:

- Create Quick Tabs programmatically
- Query Quick Tab state (minimized, pinned, solo mode, etc.)
- Trigger Quick Tab actions (close, restore, toggle solo/mute)
- Verify Manager Panel state
- Test cross-tab visibility logic
- Test any of the 20 scenarios from Issue #47

The Test Bridge is the ONLY interface between Playwright tests and the
extension's internal state.

---

## References

### Manifest V2 Documentation

1. **Chrome Extensions Manifest V2**
   - https://developer.chrome.com/docs/extensions/mv2/
   - Official V2 documentation

2. **WebRequest API (V2)**
   - https://developer.chrome.com/docs/extensions/reference/webRequest/
   - Synchronous request interception

3. **Content Scripts (V2)**
   - https://developer.chrome.com/docs/extensions/mv2/content_scripts/
   - Injection and isolated worlds

4. **Background Pages (V2)**
   - https://developer.chrome.com/docs/extensions/mv2/background_pages/
   - Persistent background context

### Content Script Injection

5. **Blob URLs**
   - https://developer.mozilla.org/en-US/docs/Web/API/Blob
   - Creating blob URLs from strings

6. **Data URLs**
   - https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs
   - Alternative to blob URLs

7. **CSP and Script Injection**
   - https://developer.chrome.com/docs/extensions/mv2/contentSecurityPolicy/
   - V2 content security policies

### Repository Context

8. **Issue #47**: All intended behaviors for Quick Tabs Feature
   - 20 test scenarios requiring Test Bridge access
   - Test Bridge pattern documented

9. **Test Bridge Architecture**
   - `src/test-bridge-page-proxy.js` - Exposed to window
   - `src/test-bridge-content-handler.js` - Message forwarding
   - `src/test-bridge-background-handler.js` - Actual API implementation
   - All must remain V2 compatible

---

## Summary

**The agentic workflow CAN use Playwright MCP**, but the extension's Test Bridge
is not exposing itself to the page context. This is a **content script
isolation** issue, most likely caused by:

1. **CSP blocking inline script injection** (Fix: Use Blob URLs - V2 compatible)
2. **Timing issues with DOM readiness** (Fix: Add defensive polling - V2
   compatible)
3. **Content script not executing in all frames** (Fix: `all_frames: true` - V2
   compatible)

**All recommended solutions are 100% Manifest V2 compatible.** The extension
MUST remain V2 due to WebRequest API dependencies. The solutions avoid any
V3-only APIs like `chrome.scripting.executeScript` with `world: 'MAIN'`.

**Implementation time: ~25 minutes for the top 4 priority fixes.**

The Playwright browsers ARE installed and working. The MCP servers ARE connected
and functional. This is purely an extension-internal issue with how the Test
Bridge injects into pages using Manifest V2 techniques.

---

**Document Version**: 2.0 (Manifest V2 Constrained)  
**Last Updated**: November 22, 2025, 10:25 PM EST  
**Author**: Diagnostic analysis with Manifest V2 compatibility requirement  
**Status**: Ready for Implementation  
**Next Step**: Implement Solutions 1, 3, 4, and 5 (all V2 compatible)
