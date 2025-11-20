# v1.6.0 Critical Fixes - Manual Testing Guide

**Purpose:** Verify all critical bug fixes are working correctly in Firefox/Zen Browser  
**Date:** November 20, 2025  
**Status:** Ready for Testing

---

## Prerequisites

1. **Build the extension:**

   ```bash
   npm run build
   ```

2. **Verify dist/ directory exists and contains:**
   - `dist/content.js` (~351KB)
   - `dist/background.js` (~140KB)
   - `dist/manifest.json`
   - `dist/icons/`
   - `dist/popup.html`, `dist/popup.js`

---

## Test 1: Content Script Loading ✅

**What This Tests:** Fix for manifest.json path mismatch (Issue #1)

### Steps:

1. Open Firefox (or Zen Browser)
2. Navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `dist/manifest.json` from the built extension
5. Navigate to any webpage (e.g., https://example.com)
6. Open browser console (F12)

### Expected Results:

✅ **PASS if:**

- Extension loads without errors
- Console shows: `[Copy-URL-on-Hover] Script loaded! @` with timestamp
- Console shows: `[Copy-URL-on-Hover] All module imports completed successfully`
- Console shows: `[Copy-URL-on-Hover] ✓ Configuration loaded successfully`
- No "Could not establish connection" errors appear

❌ **FAIL if:**

- Console shows: "Could not establish connection. Receiving end does not exist"
- Console shows: "Content script failed to load"
- Extension icon is grayed out

### Troubleshooting:

If FAIL:

1. Check `dist/content.js` exists
2. Verify `dist/manifest.json` has `"js": ["dist/content.js"]` (not just `"content.js"`)
3. Rebuild: `npm run build`
4. Reload extension in about:debugging

---

## Test 2: Quick Tabs Keyboard Shortcut (Ctrl+Alt+Z) ✅

**What This Tests:** TOGGLE_QUICK_TABS_PANEL handler implementation (Issue #2)

### Steps:

1. With extension loaded, navigate to any webpage
2. Open browser console (F12) to monitor messages
3. Press **Ctrl+Alt+Z** (or Cmd+Alt+Z on Mac)
4. Watch console for messages

### Expected Results:

✅ **PASS if:**

- Console shows: `[Content] Received TOGGLE_QUICK_TABS_PANEL request`
- Console shows: `[Content] ✓ Quick Tabs panel toggled successfully`
- OR console shows: `[Content] Quick Tabs manager not initialized` (acceptable if no Quick Tabs exist yet)
- No "Could not establish connection" errors

❌ **FAIL if:**

- Console shows: "Could not establish connection. Receiving end does not exist"
- Nothing happens when pressing Ctrl+Alt+Z
- Browser shows "Unknown command" or "Command not registered"

### Troubleshooting:

If FAIL:

1. Verify content script loaded (see Test 1)
2. Check browser console for error messages
3. Try reloading the page
4. Verify shortcut isn't conflicting with another extension

---

## Test 3: Export Console Logs Button ✅

**What This Tests:** LogHandler registration and EXPORT_LOGS message handling (Issue #2)

### Steps:

1. Click extension icon in toolbar
2. Click "Advanced" tab in popup
3. Scroll down to "Console Log Export & Management" section
4. Click **"Export Console Logs"** button
5. Watch for file save dialog

### Expected Results:

✅ **PASS if:**

- File save dialog appears
- Default filename is `console-logs-v1.6.0-[timestamp].txt`
- File downloads successfully
- File contains log entries from extension

❌ **FAIL if:**

- Error message appears: "Export Failed"
- Console shows: "Could not establish connection. Receiving end does not exist"
- No file save dialog appears
- Downloaded file is empty

### Troubleshooting:

If FAIL:

1. Check browser console for specific error messages
2. Verify LogHandler is imported in background.js (line 8)
3. Verify messageRouter.register('EXPORT_LOGS', ...) exists (line 998)
4. Try clicking "Get Background Logs" button first to populate logs

---

## Test 4: Clear Log History Button ✅

**What This Tests:** CLEAR_CONSOLE_LOGS message handling (Issue #2)

### Steps:

1. Click extension icon in toolbar
2. Click "Advanced" tab
3. Scroll down to "Console Log Export & Management" section
4. Click **"Clear Log History"** button
5. Watch for confirmation message

### Expected Results:

✅ **PASS if:**

- Success message appears: "Log history cleared successfully"
- Button changes color/state to indicate success
- Clicking "Export Console Logs" afterward shows fewer/no old logs

❌ **FAIL if:**

- Error message appears: "Clear Failed"
- Console shows: "Could not establish connection. Receiving end does not exist"
- Logs are not actually cleared (check by exporting after clearing)

### Troubleshooting:

If FAIL:

1. Check browser console for error messages
2. Verify CLEAR_CONSOLE_LOGS handler is registered (background.js line 992)
3. Verify CLEAR_CONTENT_LOGS handler exists in content.js (line 707)
4. Reload extension and try again

---

## Test 5: No Duplicate Command Listeners ✅

**What This Tests:** Removal of obsolete toggle-minimized-manager listener (Issue #4)

### Steps:

1. With extension loaded, open background script console
   - Firefox: about:debugging → This Firefox → Inspect background script
2. Look for any warnings about duplicate listeners
3. Search console for "toggle-minimized-manager"

### Expected Results:

✅ **PASS if:**

- No warnings about duplicate command listeners
- No references to "toggle-minimized-manager" in console
- Only "toggle-quick-tabs-manager" command is registered

❌ **FAIL if:**

- Console shows warnings about multiple command listeners
- "toggle-minimized-manager" appears in logs
- Pressing Ctrl+Alt+Z triggers multiple handlers

### Troubleshooting:

If FAIL:

1. Check background.js around line 1051-1070
2. Verify obsolete listener was removed
3. Only one listener should exist at line 1240
4. Rebuild and reload extension

---

## Test 6: Overall Extension Functionality ✅

**What This Tests:** General extension health after fixes

### Steps:

1. Create a Quick Tab:
   - Hover over any link on a webpage
   - Press configured shortcut (default: Ctrl+Shift+C)
   - Verify Quick Tab appears

2. Test panel toggle:
   - Press Ctrl+Alt+Z
   - Verify panel appears/disappears

3. Export logs:
   - Open popup → Advanced
   - Click "Export Console Logs"
   - Verify download succeeds

4. Clear logs:
   - Click "Clear Log History"
   - Verify success message

### Expected Results:

✅ **PASS if:**

- All features work without errors
- No "Could not establish connection" errors anywhere
- Extension feels responsive and stable

❌ **FAIL if:**

- Any feature crashes or shows errors
- Extension becomes unresponsive
- Errors appear in console during normal use

---

## Summary Checklist

Use this checklist to track testing progress:

- [ ] Test 1: Content Script Loading - PASS
- [ ] Test 2: Keyboard Shortcut (Ctrl+Alt+Z) - PASS
- [ ] Test 3: Export Console Logs Button - PASS
- [ ] Test 4: Clear Log History Button - PASS
- [ ] Test 5: No Duplicate Listeners - PASS
- [ ] Test 6: Overall Functionality - PASS

**All tests passing?** ✅ v1.6.0 critical bugs are FIXED!

**Any tests failing?** ❌ See troubleshooting sections or create GitHub issue with:

- Test number that failed
- Expected vs actual behavior
- Console error messages
- Browser version
- Extension version

---

## Automated E2E Testing

Once manual testing confirms fixes work, run automated E2E tests:

```bash
# Firefox E2E tests
npm run test:extension:firefox

# Chrome E2E tests
npm run test:extension:chrome

# All unit tests
npm test
```

Expected E2E test results:

- 21 test cases in v1.6.0-critical-fixes.spec.js
- All tests should PASS
- Tests cover: content loading, keyboard shortcuts, log export, log clear, architecture

---

## Reporting Results

After completing manual testing, report results in GitHub issue:

**Format:**

```
## v1.6.0 Manual Testing Results

**Browser:** Firefox 121 / Zen Browser 1.x
**Date:** YYYY-MM-DD
**Tester:** [Your Name]

### Test Results:
- Test 1: ✅ PASS
- Test 2: ✅ PASS
- Test 3: ✅ PASS
- Test 4: ✅ PASS
- Test 5: ✅ PASS
- Test 6: ✅ PASS

### Notes:
[Any observations, edge cases, or concerns]

### Verdict:
✅ All critical bugs fixed - Ready for release
```

---

**Questions?** Check:

- `v1.6.0-critical-bugs-diagnosis.md` - Original bug analysis
- `v1.6.0-critical-bugs-fixes-implemented.md` - Implementation details
- GitHub Issues for this milestone
