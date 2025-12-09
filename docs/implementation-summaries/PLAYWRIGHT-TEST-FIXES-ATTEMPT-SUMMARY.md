# Playwright Test Bridge and Xvfb Fixes - Implementation Summary

**Date**: November 23, 2025  
**Branch**: copilot/fix-playwright-test-issues  
**Status**: Partially Complete - Fixes Implemented, Verification Pending

---

## Overview

Attempted to fix two critical issues blocking Playwright extension testing:

1. Test Bridge not exposing to window.**COPILOT_TEST_BRIDGE**
2. Xvfb browser launch hanging for 90 seconds

---

## Issue 1: Xvfb Browser Launch Timeout

### Root Cause Analysis

- Browser hanging at `launchPersistentContext` for 90 seconds
- Insufficient Xvfb initialization (2-second blind sleep)
- Missing Chromium flags for virtual display compatibility
- No health check to verify display readiness

### Fixes Implemented

#### 1.1 X11 Dependencies Installation

**File**: `.github/workflows/copilot-setup-steps.yml`

Added comprehensive X11 packages:

```yaml
sudo apt-get install -y \ xvfb \ x11-utils \ x11-xserver-utils \ xfonts-base \
xfonts-100dpi \ xfonts-75dpi \ xfonts-scalable \ fonts-liberation \ libxrandr2 \
libxcomposite1 \ libxdamage1 \ libxext6
```

**Rationale**: Perplexity research confirmed these packages are essential for
X11 display functionality.

#### 1.2 Xvfb Health Check

**File**: `.github/workflows/copilot-setup-steps.yml`

Replaced blind `sleep 2` with active health check:

```bash
# Start Xvfb with enhanced flags
Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp -dpi 96 +extension RANDR &

# Wait for Xvfb to be ready (up to 30 seconds)
for i in {1..30}; do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "✓ Xvfb is ready after ${i} seconds"
    break
  fi
  sleep 1
done
```

**Rationale**: Industry standard (verified via Perplexity) is 3+ seconds wait
with active verification, not blind sleep.

#### 1.3 Pre-Flight Display Test

**File**: `.github/workflows/copilot-setup-steps.yml`

Added pre-flight test step:

- Verifies display info query works
- Checks display dimensions (1920x1080)
- Tests simple X11 app (xeyes) launches

**Rationale**: Catches display issues before expensive browser launch.

#### 1.4 Chromium Launch Flags for Xvfb

**File**: `tests/extension/fixtures.js`

Added critical flags for virtual display:

```javascript
('--use-gl=swiftshader', // Software renderer
  '--disable-accelerated-2d-canvas', // Disable 2D acceleration
  '--disable-accelerated-video-decode', // Disable video acceleration
  '--disable-gl-drawing-for-tests', // Prevent OpenGL init
  '--disable-dev-shm-usage', // CRITICAL: Prevents /dev/shm exhaustion
  '--window-size=1920,1080'); // Match Xvfb screen size
```

Increased timeout from 60s to 90s to match test timeout.

**Rationale**: Perplexity research identified `--disable-dev-shm-usage` as
**critical** for preventing shared memory exhaustion in CI.
`--use-gl=swiftshader` forces software rendering, bypassing GPU issues.

### Verification Status

❌ **Not Verified** - Test hangs when run locally, unable to confirm fixes work

---

## Issue 2: Test Bridge Not Exposing to Window

### Root Cause Analysis

- Content script injection using `script.textContent` fails silently
- Blocked by Content Security Policy (CSP) `script-src` restrictions
- CSP requires `'unsafe-inline'` for inline scripts
- Most pages don't allow `'unsafe-inline'` for security

### Fixes Implemented

#### 2.1 Blob URL Injection (CSP Bypass)

**File**: `scripts/inject-test-bridge.cjs`

Replaced inline `script.textContent` with Blob URL:

```javascript
// OLD (blocked by CSP):
script.textContent = testBridgeCode;

// NEW (bypasses CSP):
const blob = new Blob([testBridgeCode], { type: 'application/javascript' });
const blobUrl = URL.createObjectURL(blob);
script.src = blobUrl; // Use src, not textContent
script.onload = () => URL.revokeObjectURL(blobUrl);
```

**Rationale**: Perplexity research confirmed Blob URLs bypass CSP `script-src`
restrictions more reliably than inline scripts. This is **Manifest V2
compatible** (no V3 APIs required).

#### 2.2 Content Script Marker

**File**: `scripts/inject-test-bridge.cjs`

Added verification marker:

```javascript
const marker = document.createElement('meta');
marker.name = 'copilot-content-script-loaded';
marker.content = 'true';
```

**Rationale**: Helps verify content script actually executes, separate from test
bridge injection issue.

#### 2.3 Defensive Polling for DOM Ready

**File**: `scripts/inject-test-bridge.cjs`

Added retry logic:

```javascript
function attemptInject(attempts = 0) {
  const targetElement = document.head || document.documentElement;
  if (!targetElement) {
    if (attempts < 50) {
      // Max 500ms wait
      setTimeout(() => attemptInject(attempts + 1), 10);
      return;
    }
    console.error('[CONTENT SCRIPT] Failed to inject: no DOM after 500ms');
    return;
  }
  // ... inject code
}
```

**Rationale**: Ensures DOM is ready before injection, handles race conditions.

#### 2.4 Enhanced Logging

**File**: `src/test-bridge-page-proxy.js`

Added detailed diagnostic logs:

```javascript
console.log('[TEST BRIDGE PAGE PROXY] Starting execution');
console.log('[TEST BRIDGE PAGE PROXY] typeof window:', typeof window);
console.log(
  '[TEST BRIDGE PAGE PROXY] document.readyState:',
  document.readyState
);
console.log('[TEST BRIDGE PAGE PROXY] Bridge exposed to window');
console.log(
  '[TEST BRIDGE PAGE PROXY] Bridge methods:',
  Object.keys(window.__COPILOT_TEST_BRIDGE__)
);
```

**Rationale**: Helps diagnose exactly where injection fails in browser console.

#### 2.5 Manifest Changes

**File**: `manifest.json`

Changed `all_frames` from `false` to `true`:

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["dist/content.js"],
  "run_at": "document_end",
  "all_frames": true
}]
```

**Rationale**: Ensures content script runs in all frames, not just top frame.
Necessary for iframe support.

### Verification Status

❌ **Not Verified** - Test hangs when run locally, unable to confirm test bridge
is accessible

---

## Verification Attempts

### Build Status

✅ **SUCCESS** - Extension builds with `TEST_MODE=true`

```bash
npm run build:test
# Output: ✅ Test bridge injection complete!
```

### Test Execution Status

❌ **FAILURE** - Test hangs indefinitely

Attempted test:

```bash
npm run test:extension:chrome -- tests/extension/test-bridge-check.spec.js
```

**Behavior**: Command runs but produces no output after 180+ seconds, suggesting
browser launch hangs or fails silently.

### Possible Causes of Test Hang

1. **Xvfb not available in local environment** - Fixes designed for GitHub
   Actions CI
2. **Browser launch failure** - Silent timeout without error message
3. **Playwright configuration issue** - Extension not loading properly
4. **Test bridge still broken** - CSP restrictions persisting despite Blob URL

---

## Research and Verification

### Perplexity Research Findings

#### Xvfb Configuration

✅ Verified industry standards:

- Wait time: 3+ seconds (not 2)
- Use `xdpyinfo` for health check, not blind sleep
- `--disable-dev-shm-usage` is **critical** for CI environments

#### CSP and Blob URLs

✅ Verified CSP bypass:

- Blob URLs bypass CSP `script-src` restrictions
- More reliable than inline `script.textContent`
- **Limitation**: Still blocked if page CSP explicitly blocks `blob:` origins

#### Manifest V2 Compatibility

✅ All solutions are Manifest V2 compatible:

- Blob URLs work in MV2
- No V3-only APIs used
- Works in both Firefox and Chrome

### Context7 Verification

❌ **Not Done** - Still need to verify WebExtension API usage

---

## Next Steps

### Immediate (Required)

1. **Run tests in actual CI environment** (GitHub Actions)
   - Local environment may not have Xvfb configured
   - CI workflow has proper Xvfb setup
2. **Add diagnostic logging to understand hang point**
   - Is browser launching?
   - Is extension loading?
   - Is content script executing?

3. **Verify test bridge in browser console manually**
   - Load extension in Chrome/Firefox
   - Navigate to example.com
   - Check if `window.__COPILOT_TEST_BRIDGE__` exists

### Alternative Approaches (If Current Fixes Fail)

#### Option A: Extension URL Fallback

If Blob URLs don't work, try extension URL:

```javascript
const script = document.createElement('script');
script.src = chrome.runtime.getURL('test-bridge.js');
```

**Pros**: Bypasses CSP entirely (extension resources exempt)  
**Cons**: Requires `test-bridge.js` in `web_accessible_resources`

#### Option B: postMessage Communication

If DOM injection impossible, use postMessage:

```javascript
// Content script exposes bridge via postMessage
window.addEventListener('message', event => {
  if (event.data.type === 'TEST_BRIDGE_CALL') {
    // Forward to background
  }
});
```

**Pros**: Avoids CSP issues entirely  
**Cons**: More complex communication pattern

#### Option C: Relaxed CSP for Test Pages

If control test pages, add CSP header:

```
Content-Security-Policy: script-src 'self' 'unsafe-inline' blob:
```

**Pros**: Guaranteed to work  
**Cons**: Only works on pages we control

---

## Files Modified

### Workflow Configuration

- `.github/workflows/copilot-setup-steps.yml` - Xvfb setup and health checks

### Extension Code

- `manifest.json` - Changed `all_frames` to `true`
- `scripts/inject-test-bridge.cjs` - Blob URL injection with retry logic
- `src/test-bridge-page-proxy.js` - Enhanced logging
- `tests/extension/fixtures.js` - Chromium launch flags, timeout increase

### Memory Files

- `.agentic-tools-mcp/memories/troubleshooting/Xvfb_Virtual_Display_Configuration_for_Playwright.json`
- `.agentic-tools-mcp/memories/troubleshooting/Test_Bridge_CSP_Bypass_with_Blob_URLs.json`

---

## Lessons Learned

### What Worked

1. ✅ Perplexity research provided accurate, actionable guidance
2. ✅ Industry standards (3s+ Xvfb wait, health checks) are well-documented
3. ✅ Blob URL approach is theoretically sound (verified via research)
4. ✅ All fixes are Manifest V2 compatible

### What Didn't Work

1. ❌ Unable to verify fixes locally (test hangs)
2. ❌ No clear error messages to diagnose hang point
3. ❌ Insufficient time to test in actual CI environment

### What's Uncertain

1. ❓ Will Xvfb health checks work in CI?
2. ❓ Will Blob URLs actually bypass CSP in practice?
3. ❓ Is the test hang due to Xvfb, test bridge, or something else?

---

## Recommendations

### For Next Session

1. **Test in CI first** - Don't assume local environment matches CI
2. **Add more diagnostic logging** - Need to see where it fails
3. **Manual browser testing** - Load extension, check console for test bridge
4. **Consider alternative approaches** if Blob URLs don't work

### For Long-Term Maintenance

1. **Document CSP requirements** - List which CSP policies break test bridge
2. **Add fallback strategies** - Extension URL, postMessage, etc.
3. **Automate verification** - Add test that checks test bridge availability
4. **Monitor CI logs** - Watch for Xvfb errors or browser launch failures

---

## Conclusion

Implemented comprehensive fixes for both Xvfb and test bridge issues based on
industry research. All fixes are theoretically sound and Manifest V2 compatible.
However, verification is incomplete due to test hang in local environment.

**Recommendation**: Run tests in actual CI environment (GitHub Actions) to
confirm fixes work in practice. The workflow changes should address Xvfb issues,
and Blob URL injection should bypass CSP restrictions.

**Confidence Level**: 70% - Fixes are based on solid research, but lack of
verification means success is not guaranteed.

---

**Document Author**: GitHub Copilot Agent  
**Last Updated**: November 23, 2025, 4:15 AM EST  
**Next Review**: After CI test run
