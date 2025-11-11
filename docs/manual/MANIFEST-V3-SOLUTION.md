# Manifest V3 Solution: Keeping Blocking WebRequest in Firefox/Zen Browser

**Goal**: Stay on Manifest V3 while solving X-Frame-Options issue
**Browser**: Firefox/Zen Browser
**Date**: November 10, 2025

---

## GOOD NEWS: Firefox Supports Blocking WebRequest in Manifest V3!

Unlike Chrome, **Firefox explicitly maintains blocking webRequest support in Manifest V3**[175][181][187][192][200].

### Official Mozilla Statement

> "Mozilla will maintain support for blocking WebRequest in MV3. To maximize compatibility with other browsers, we will also ship support for declarativeNetRequest. We will continue to work with content blockers and other key consumers of this API to identify current and future alternatives where appropriate."[181][192]

This means you **CAN** use blocking webRequest in MV3 on Firefox/Zen Browser!

---

## Why Your Current MV3 Implementation Doesn't Work

### Issue #1: Invalid Permission

Your manifest.json includes:
```json
"permissions": ["webRequest", "webRequestBlocking"]
```

**Problem**: `webRequestBlocking` is a **Manifest V2-only permission**[190][200][203].

In Manifest V3:
- ❌ Chrome: Doesn't support blocking webRequest at all[174][188][190]
- ✅ Firefox: Supports blocking webRequest BUT uses different permission syntax[200]

### Issue #2: Missing Event Page Configuration

Manifest V3 requires **event pages** (not service workers) for Firefox blocking webRequest[192].

Your current manifest has:
```json
"background": {
  "scripts": ["background.js"]
}
```

This is incomplete for MV3. Need to specify `type`.

---

## Complete Manifest V3 Solution for Firefox/Zen Browser

### Step 1: Fix manifest.json

```json
{
  "manifest_version": 3,
  "name": "Copy URL on Hover Custom",
  "version": "1.5.5.6",
  "description": "Copy URLs or link text while hovering over links. Enhanced Quick Tabs with navigation, minimize, and more.",
  
  "permissions": [
    "storage",
    "activeTab",
    "webRequest"
  ],
  
  "host_permissions": [
    "<all_urls>"
  ],
  
  "background": {
    "scripts": ["background.js"],
    "type": "module"
  },
  
  "action": {
    "default_title": "Copy URL on Hover Settings",
    "default_popup": "popup.html"
  },
  
  "sidebar_action": {
    "default_panel": "sidebar.html",
    "default_title": "Quick Tabs",
    "default_icon": "icons/icon.png"
  },
  
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

### Key Changes from Your Current Manifest:

1. **REMOVED** `webRequestBlocking` permission (MV2 only)[190][200]
2. **REMOVED** `scripting` permission (not needed for webRequest)
3. **REMOVED** `sidePanel` permission (Chrome MV3 specific, not Firefox)
4. **REMOVED** `side_panel` key (use `sidebar_action` for Firefox)
5. **KEPT** `webRequest` permission (required)[200]
6. **KEPT** `host_permissions: ["<all_urls>"]` (required for modifying headers)[204]
7. **ADDED** `"type": "module"` to background (optional but recommended)

---

### Step 2: Update background.js

Your background.js code is **almost correct**, just needs minor fixes:

```javascript
// ==================== X-FRAME-OPTIONS BYPASS FOR QUICK TABS ====================
// Firefox Manifest V3 - Supports blocking webRequest
// Reference: https://blog.mozilla.org/addons/2022/05/18/manifest-v3-in-firefox-recap-next-steps/

console.log('[Quick Tabs] Initializing Firefox MV3 X-Frame-Options bypass...');

// Track modified URLs for debugging
const modifiedUrls = new Set();

// Install blocking webRequest listener (Firefox MV3 supports this!)
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    console.log(`[Quick Tabs] Processing: ${details.type} - ${details.url}`);
    
    // Filter out blocking headers
    const modifiedHeaders = details.responseHeaders.filter(header => {
      const headerName = header.name.toLowerCase();
      
      // Remove X-Frame-Options header
      if (headerName === 'x-frame-options') {
        console.log(`[Quick Tabs] ✓ Removed X-Frame-Options: ${header.value} from ${details.url}`);
        modifiedUrls.add(details.url);
        return false; // Remove this header
      }
      
      // Modify Content-Security-Policy
      if (headerName === 'content-security-policy') {
        const originalValue = header.value;
        
        // Remove frame-ancestors directive
        header.value = header.value.replace(/frame-ancestors[^;]*(;|$)/gi, '');
        
        // If CSP is now empty, remove it entirely
        if (header.value.trim() === '' || header.value.trim() === ';') {
          console.log(`[Quick Tabs] ✓ Removed empty CSP from ${details.url}`);
          modifiedUrls.add(details.url);
          return false;
        }
        
        // Log if we modified it
        if (header.value !== originalValue) {
          console.log(`[Quick Tabs] ✓ Modified CSP for ${details.url}`);
          modifiedUrls.add(details.url);
        }
      }
      
      // Remove restrictive Cross-Origin-Resource-Policy
      if (headerName === 'cross-origin-resource-policy') {
        const value = header.value.toLowerCase();
        if (value === 'same-origin' || value === 'same-site') {
          console.log(`[Quick Tabs] ✓ Removed CORP: ${header.value} from ${details.url}`);
          modifiedUrls.add(details.url);
          return false;
        }
      }
      
      return true; // Keep header
    });
    
    return { responseHeaders: modifiedHeaders };
  },
  {
    urls: ['<all_urls>'],
    types: ['sub_frame']  // Only iframes
  },
  ['blocking', 'responseHeaders']  // Firefox MV3 allows 'blocking'
);

console.log('[Quick Tabs] ✓ Firefox MV3 X-Frame-Options bypass installed');

// Log successful loads
browser.webRequest.onCompleted.addListener(
  (details) => {
    if (modifiedUrls.has(details.url)) {
      console.log(`[Quick Tabs] ✅ Successfully loaded iframe: ${details.url}`);
    }
  },
  {
    urls: ['<all_urls>'],
    types: ['sub_frame']
  }
);

// Log failed loads
browser.webRequest.onErrorOccurred.addListener(
  (details) => {
    console.error(`[Quick Tabs] ❌ Failed to load iframe: ${details.url}`);
    console.error(`[Quick Tabs] Error: ${details.error}`);
  },
  {
    urls: ['<all_urls>'],
    types: ['sub_frame']
  }
);

// ==================== END X-FRAME-OPTIONS BYPASS ====================

// ... rest of your background.js code ...
```

---

## Why This Works in Firefox MV3

### Firefox's Unique Approach

Firefox diverges from Chrome's MV3 implementation in two critical ways[175][181][187][192]:

1. **Event Pages Support**: Firefox continues to support DOM-based background scripts (event pages) instead of requiring service workers[192]

2. **Blocking WebRequest**: Firefox maintains the blocking webRequest API for privacy and content blocking use cases[175][181][187]

**Official Statement**[192]:
> "We continue to support DOM-based background scripts in the form of Event pages, and the blocking webRequest feature, as explained in our previous blog post."

### Why Chrome Doesn't Support This

Chrome removed blocking webRequest in MV3 and forces use of `declarativeNetRequest`[174][188][190][194].

**Problem**: declarativeNetRequest **CANNOT** modify response headers[182][201], only:
- Block requests
- Redirect requests  
- Modify **request** headers (not response headers)

**This means**: In Chrome MV3, there is **NO WAY** to remove X-Frame-Options headers[199].

### Firefox to the Rescue

Firefox recognized this limitation and explicitly chose to keep blocking webRequest[175][181][187]:

> "Chrome's solution in MV3 was to define a more narrowly scoped API (declarativeNetRequest) as a replacement. However, this will limit the capabilities of certain types of privacy extensions without adequate replacement."[181]

---

## declarativeNetRequest: Why It Won't Work

### What declarativeNetRequest Can Do

In Manifest V3, `declarativeNetRequest` can[182][198][201][204]:

1. **Modify Request Headers** (before sending to server):
   ```javascript
   {
     action: {
       type: "modifyHeaders",
       requestHeaders: [
         {
           header: "User-Agent",
           operation: "set",
           value: "CustomAgent"
         }
       ]
     }
   }
   ```

2. **Modify Response Headers** (VERY LIMITED)[198][201]:
   - Can SET response headers
   - Can APPEND to response headers
   - **CANNOT REMOVE response headers**[199][201]

### The Problem

To fix X-Frame-Options, you need to **REMOVE** the header, not SET or APPEND[199].

**Attempted Solution (Doesn't Work)**:
```javascript
// This DOES NOT remove X-Frame-Options!
{
  action: {
    type: "modifyHeaders",
    responseHeaders: [
      {
        header: "x-frame-options",
        operation: "remove"  // ❌ 'remove' operation doesn't exist
      }
    ]
  }
}
```

**Available Operations in declarativeNetRequest**[182][204]:
- `"set"` - Replace header value
- `"append"` - Add to header value
- `"remove"` - **Only for REQUEST headers, not RESPONSE headers**[201]

### Workaround Attempts (All Fail)

#### Attempt 1: Set Empty Value
```javascript
{
  header: "x-frame-options",
  operation: "set",
  value: ""  // ❌ Browser still sees header, treats empty as invalid
}
```
**Result**: Browser sees header is present and blocks iframe.

#### Attempt 2: Set Invalid Value
```javascript
{
  header: "x-frame-options",
  operation: "set",
  value: "ALLOWALL"  // ❌ Invalid value, browser defaults to DENY
}
```
**Result**: Browser treats invalid values as DENY[122][125].

#### Attempt 3: Override with GOFORIT
Some sources suggest setting `X-Frame-Options: GOFORIT` disables blocking[49].

```javascript
{
  header: "x-frame-options",
  operation: "set",
  value: "GOFORIT"  // ⚠️ Only works if server sends multiple X-Frame-Options
}
```
**Result**: Only works if server already sends conflicting headers, which is rare[49].

### Conclusion

**declarativeNetRequest cannot solve the X-Frame-Options problem**[199][201].

---

## Cross-Browser Compatibility Strategy

If you want your extension to work in both **Firefox** and **Chrome**:

### Option 1: Firefox-Only MV3 (Recommended)

Focus on Firefox/Zen Browser support using blocking webRequest[181][192]:

```json
{
  "manifest_version": 3,
  "browser_specific_settings": {
    "gecko": {
      "id": "your-extension-id"
    }
  }
}
```

**Pros**:
- ✅ Full functionality in Firefox
- ✅ Uses MV3 for future-proofing
- ✅ Simpler implementation

**Cons**:
- ❌ Won't work in Chrome (but that's okay if you target Firefox/Zen)

### Option 2: Dual Manifest Approach

Publish **two versions**:
- **Firefox version**: MV3 with blocking webRequest
- **Chrome version**: MV2 (before Chrome removes it) or accept limited functionality

### Option 3: Feature Detection

Detect browser capabilities at runtime:

```javascript
// In background.js
const hasBlockingWebRequest = typeof browser !== 'undefined' && 
                               browser.webRequest &&
                               browser.webRequest.onHeadersReceived;

if (hasBlockingWebRequest) {
  // Firefox - use blocking webRequest
  browser.webRequest.onHeadersReceived.addListener(
    requestListener,
    { urls: ['<all_urls>'], types: ['sub_frame'] },
    ['blocking', 'responseHeaders']
  );
} else {
  // Chrome - fallback behavior
  console.warn('[Quick Tabs] Blocking webRequest not available');
  console.warn('[Quick Tabs] X-Frame-Options bypass will not work');
}
```

---

## Testing Your MV3 Implementation

### Step 1: Verify Extension Loads

1. Go to `about:debugging` in Firefox/Zen
2. Click "This Firefox" or "This Zen"
3. Click "Load Temporary Add-on"
4. Select your `manifest.json`
5. **Check for errors** in the console

**Expected**: No errors, extension loads successfully.

### Step 2: Check Browser Console

1. Open Browser Console (`Ctrl+Shift+J` or `Cmd+Option+J`)
2. Look for initialization message:
   ```
   [Quick Tabs] Initializing Firefox MV3 X-Frame-Options bypass...
   [Quick Tabs] ✓ Firefox MV3 X-Frame-Options bypass installed
   ```

**If you don't see this**: The listener isn't registering.

### Step 3: Test with YouTube

1. Navigate to Wikipedia
2. Open Quick Tab for YouTube video
3. Check Browser Console for:
   ```
   [Quick Tabs] Processing: sub_frame - https://youtube.com/watch?v=...
   [Quick Tabs] ✓ Removed X-Frame-Options: SAMEORIGIN from https://youtube.com/...
   [Quick Tabs] ✅ Successfully loaded iframe: https://youtube.com/...
   ```

**Expected**: YouTube loads in Quick Tab without error.

### Step 4: Test with GitHub

1. Navigate to any page
2. Open Quick Tab for GitHub repository
3. Check Browser Console for:
   ```
   [Quick Tabs] Processing: sub_frame - https://github.com/user/repo
   [Quick Tabs] ✓ Removed X-Frame-Options: DENY from https://github.com/...
   [Quick Tabs] ✅ Successfully loaded iframe: https://github.com/...
   ```

**Expected**: GitHub loads in Quick Tab without error.

### Step 5: Network Tab Verification

1. Open Developer Tools (F12) on the **page** (not Browser Console)
2. Go to **Network** tab
3. Filter for `iframe` or the specific URL
4. Click on the iframe request
5. Go to **Headers** tab
6. Look in **Response Headers** section

**Note**: Firefox Developer Tools show ORIGINAL headers from server, not modified ones. This is expected[163].

To verify modification worked, check that the **iframe loads successfully** (no error message).

---

## Common Issues and Solutions

### Issue 1: "Error: Type error for parameter extensionTypes"

**Cause**: Trying to use Chrome-specific APIs in Firefox.

**Solution**: Remove Chrome-specific permissions:
```json
// Remove these from manifest.json:
"sidePanel",
"side_panel",
"scripting"
```

### Issue 2: "webRequestBlocking is not allowed"

**Cause**: Including MV2 permission in MV3 manifest.

**Solution**: Remove `"webRequestBlocking"` from permissions[190][200].

### Issue 3: Listener Not Firing

**Symptoms**: No console logs from webRequest listener.

**Possible Causes**:
1. Missing `host_permissions: ["<all_urls>"]`[204]
2. Missing `webRequest` permission
3. Incorrect filter configuration

**Solution**:
```json
{
  "permissions": ["webRequest"],
  "host_permissions": ["<all_urls>"]
}
```

### Issue 4: "Cannot modify response headers"

**Cause**: Zen Browser may have additional restrictions.

**Solution**: Check `about:config` for:
```
extensions.webextensions.restrictedDomains
```

If set, clear it or remove blocked domains.

---

## Performance Considerations

### Filtering at Registration vs Runtime

**Current** (your code):
```javascript
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== 'sub_frame') {
      return { responseHeaders: details.responseHeaders };
    }
    // ... process
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'responseHeaders']
);
```

**Optimized**:
```javascript
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    // No type check needed - already filtered
    // ... process
  },
  {
    urls: ['<all_urls>'],
    types: ['sub_frame']  // Filter at registration
  },
  ['blocking', 'responseHeaders']
);
```

**Benefit**: Browser filters requests before calling listener, reducing function invocations.

---

## Summary

### ✅ YES, You Can Stay on Manifest V3!

**For Firefox/Zen Browser**:
1. Remove `webRequestBlocking` permission (MV2 only)[190][200]
2. Keep `webRequest` permission[200]
3. Add `host_permissions: ["<all_urls>"]`[204]
4. Use event pages (`background.scripts`)[192]
5. Your blocking webRequest code works as-is![175][181][187]

### ❌ NO, declarativeNetRequest Won't Work

- declarativeNetRequest **cannot remove response headers**[199][201]
- Only Firefox supports blocking webRequest in MV3[175][181][187][192]
- Chrome MV3 has **no solution** for X-Frame-Options removal[199]

### 🎯 Recommended Approach

**Use Firefox MV3 with blocking webRequest**:
- Future-proof (MV3)
- Fully functional (blocking webRequest)
- Firefox-specific but that's fine for Zen Browser
- Official Mozilla support[181][192]

---

## Final manifest.json Template

```json
{
  "manifest_version": 3,
  "name": "Copy URL on Hover Custom",
  "version": "1.5.5.6",
  
  "permissions": [
    "storage",
    "webRequest"
  ],
  
  "host_permissions": [
    "<all_urls>"
  ],
  
  "background": {
    "scripts": ["background.js"]
  },
  
  "action": {
    "default_popup": "popup.html"
  },
  
  "sidebar_action": {
    "default_panel": "sidebar.html"
  },
  
  "icons": {
    "96": "icons/icon.png"
  },
  
  "browser_specific_settings": {
    "gecko": {
      "id": "copy-url-hover@chunkynosher.github.io"
    }
  }
}
```

**That's it!** Your existing background.js code will work with these changes.
