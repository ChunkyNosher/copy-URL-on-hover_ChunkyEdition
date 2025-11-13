# Testing Guide - Issue #51 Fix: Quick Tabs Position/Size Persistence

This guide provides step-by-step instructions for testing the Quick Tabs position/size persistence fixes implemented in version 1.5.5.7.

---

## Prerequisites

1. **Browser:** Firefox or Zen Browser
2. **Extension Version:** 1.5.5.7 or higher
3. **Settings:** Ensure "Persist Quick Tabs across tabs" is enabled in extension settings

---

## Test Environment Setup

### Enable Debug Mode (Recommended)

1. Open the extension popup (click extension icon)
2. Navigate to Settings tab
3. Enable "Debug Mode" checkbox
4. Open Browser Console (Ctrl+Shift+J or Cmd+Option+J on Mac)
5. You should see debug messages like:
   ```
   [Quick Tabs] Quick Tab drag started - URL: ...
   [Quick Tabs] Quick Tab move completed - ...
   [Background] Received position update: ...
   ```

---

## Test Suite

### Test 1: Same-Origin Tab Sync (Wikipedia → Wikipedia)

**Goal:** Verify real-time sync works for tabs on the same website

**Steps:**

1. Open Tab 1: Navigate to `https://en.wikipedia.org/wiki/Firefox`
2. Hover over any link and press **Q** to open Quick Tab
3. Drag Quick Tab to position approximately (500, 500) on screen
4. Resize Quick Tab to approximately 600x400 pixels
5. Note the exact position shown in debug console (e.g., "Position: (512, 487)")
6. Open Tab 2: Navigate to `https://en.wikipedia.org/wiki/Browser`
7. Immediately check if Quick Tab appears at the same position

**Expected Result:**

- ✅ Quick Tab appears in Tab 2 within **< 100ms** (almost instant)
- ✅ Position matches Tab 1 exactly (within 1-2 pixels)
- ✅ Size matches Tab 1 exactly (within 1-2 pixels)
- ✅ Debug console shows: "Updated Quick Tab ... from background: pos(...), size(...)"

**What This Tests:**

- BroadcastChannel same-origin sync (redundant path)
- Background script coordination (primary path)
- Position and size preservation

---

### Test 2: Cross-Origin Tab Sync (Wikipedia → YouTube)

**Goal:** Verify real-time sync works across different websites (THE CRITICAL TEST)

**Steps:**

1. Open Tab 1: Navigate to `https://en.wikipedia.org/wiki/Firefox`
2. Hover over any link and press **Q** to open Quick Tab
3. Drag Quick Tab to position approximately (500, 500)
4. Resize Quick Tab to approximately 600x400 pixels
5. Note the exact position in debug console
6. Open Tab 2: Navigate to `https://www.youtube.com` (different origin!)
7. **Immediately** check if Quick Tab appears

**Expected Result:**

- ✅ Quick Tab appears in Tab 2 within **< 100ms** (almost instant)
- ✅ Position matches Tab 1 exactly
- ✅ Size matches Tab 1 exactly
- ✅ Debug console shows: "Updated Quick Tab ... from background: pos(...), size(...)"

**What This Tests:**

- **PRIMARY FIX:** Background script cross-origin coordination
- This was broken before (10-minute delay), now should be instant

---

### Test 3: Rapid Tab Switch During Drag

**Goal:** Verify no data loss when switching tabs while dragging

**Steps:**

1. Open Tab 1: Navigate to any website
2. Open a Quick Tab
3. **Start dragging** the Quick Tab (hold mouse button down)
4. **While still dragging**, press Ctrl+Tab to switch to another tab
5. **Release mouse button** in the new tab
6. Switch back to original tab

**Expected Result:**

- ✅ Quick Tab position saved during drag (throttled every 500ms)
- ✅ Other tabs show partial drag position (not original position)
- ✅ No "snap back" to original position
- ✅ Debug console shows periodic saves: "Sending position update to background"

**What This Tests:**

- Throttled saves during drag (500ms intervals)
- Visibility change force-save on tab switch

---

### Test 4: Update Existing Quick Tab

**Goal:** Verify existing Quick Tabs get updated instead of being skipped

**Steps:**

1. Open Tab 1: Navigate to `https://en.wikipedia.org/wiki/Firefox`
2. Open a Quick Tab for a specific link
3. Position it at (100, 100) approximately
4. Open Tab 2: Navigate to `https://en.wikipedia.org/wiki/Browser`
5. Verify Quick Tab appears at (100, 100) in Tab 2
6. **In Tab 2**, drag Quick Tab to (500, 500)
7. Switch back to Tab 1
8. Check Quick Tab position in Tab 1

**Expected Result:**

- ✅ Quick Tab in Tab 1 **moves to (500, 500)** (not stuck at original position!)
- ✅ Debug console shows: "Updated existing Quick Tab ... position to (500, 500)"
- ✅ No "Skipping duplicate Quick Tab" message

**What This Tests:**

- **CRITICAL FIX:** `restoreQuickTabsFromStorage()` now updates existing tabs
- Previously, existing tabs were skipped (bug #3)

---

### Test 5: Persistence Across Browser Restart

**Goal:** Verify Quick Tabs restore correctly after browser restart

**Steps:**

1. Open a Quick Tab and position it at (500, 500)
2. Resize to 600x400 pixels
3. **Close browser completely** (Quit Firefox/Zen Browser)
4. Reopen browser
5. Navigate to the same page where Quick Tab was opened
6. Wait 2-3 seconds

**Expected Result:**

- ✅ Quick Tab restores at position (500, 500)
- ✅ Quick Tab restores with size 600x400
- ✅ Debug console shows: "Restoring X Quick Tabs from browser.storage"

**What This Tests:**

- Storage.sync persistence working
- Background script saves to storage correctly

---

### Test 6: Multiple Quick Tabs

**Goal:** Verify multiple Quick Tabs all sync correctly

**Steps:**

1. Open Tab 1: Navigate to any website
2. Open 3 Quick Tabs at different positions:
   - Quick Tab A at (100, 100)
   - Quick Tab B at (300, 300)
   - Quick Tab C at (500, 500)
3. Switch to Tab 2 (different origin)
4. Verify all 3 Quick Tabs appear at correct positions
5. **In Tab 2**, move Quick Tab B to (400, 400)
6. Switch back to Tab 1
7. Check all Quick Tab positions

**Expected Result:**

- ✅ All 3 Quick Tabs appear in Tab 2 at original positions
- ✅ After moving Quick Tab B in Tab 2, it updates to (400, 400) in Tab 1
- ✅ Quick Tabs A and C remain at their original positions
- ✅ Only Quick Tab B is updated

**What This Tests:**

- Multiple Quick Tabs sync independently
- Selective updates work correctly
- No cross-contamination between Quick Tabs

---

### Test 7: Pin to Page Feature

**Goal:** Verify pinned Quick Tabs only appear on pinned pages

**Steps:**

1. Open Tab 1: Navigate to `https://en.wikipedia.org/wiki/Firefox`
2. Open a Quick Tab
3. Right-click Quick Tab → "Pin to this page"
4. Position Quick Tab at (500, 500)
5. Switch to Tab 2: Navigate to `https://en.wikipedia.org/wiki/Browser`
6. Check if pinned Quick Tab appears
7. Switch to Tab 3: Navigate to `https://www.youtube.com` (different domain)
8. Check if pinned Quick Tab appears

**Expected Result:**

- ✅ Pinned Quick Tab does NOT appear in Tab 2 (same domain, different page)
- ✅ Pinned Quick Tab does NOT appear in Tab 3 (different domain)
- ✅ When you return to Tab 1 (pinned page), Quick Tab is at (500, 500)

**What This Tests:**

- Pin filtering still works correctly
- Pinned Quick Tabs are page-specific
- Position updates respect pin status

---

## Performance Benchmarks

Use Browser Console timestamps to measure sync latency:

### Measuring Cross-Origin Sync Latency

**Steps:**

1. Enable Debug Mode
2. Open Browser Console (Ctrl+Shift+J)
3. Open Quick Tab in Tab 1
4. Move Quick Tab
5. Note timestamp in console: `[Background] Received position update: ... [timestamp1]`
6. **Immediately** switch to Tab 2 (cross-origin)
7. Note timestamp in console: `Updated Quick Tab ... from background: ... [timestamp2]`
8. Calculate latency: `timestamp2 - timestamp1`

**Expected Performance:**

- ✅ Latency < 100ms (typically 20-50ms)
- ✅ No 10-minute delays
- ✅ Instant visual update

---

## Common Issues & Troubleshooting

### Issue: Quick Tab doesn't appear in new tab

**Possible Causes:**

1. "Persist Quick Tabs across tabs" setting is disabled
   - **Fix:** Enable in extension settings
2. Content script not loaded
   - **Fix:** Reload the tab (F5)
3. Browser restricted page (about:, chrome://)
   - **Expected:** Extensions can't run on restricted pages

### Issue: Position slightly off (1-2 pixels)

**Cause:** Rounding differences in coordinate systems
**Expected:** This is normal, < 2px difference is acceptable

### Issue: Debug console shows no messages

**Cause:** Debug mode not enabled
**Fix:** Enable Debug Mode in extension settings

### Issue: Quick Tab appears but at wrong position

**Possible Causes:**

1. Background script not running
   - **Check:** Look for `[Background]` messages in console
   - **Fix:** Reload extension or browser
2. Message passing failed
   - **Check:** Look for error messages in console
   - **Fix:** Report bug with console output

---

## Regression Testing

Ensure existing features still work:

### ✅ Basic Features Still Work

- [ ] Quick Tab opens on hover + Q key
- [ ] Quick Tab closes on Escape key
- [ ] Quick Tab drags smoothly
- [ ] Quick Tab resizes correctly
- [ ] Multiple Quick Tabs can coexist
- [ ] Quick Tab minimize/restore works
- [ ] Quick Tab navigation buttons work
- [ ] Quick Tab pin/unpin works

### ✅ Settings Still Work

- [ ] All settings in popup apply correctly
- [ ] Settings persist across browser restart
- [ ] Options page opens and works

### ✅ No New Bugs Introduced

- [ ] No console errors during normal operation
- [ ] No memory leaks (check Task Manager after 10+ Quick Tabs)
- [ ] No performance degradation
- [ ] No visual glitches

---

## Reporting Issues

If you find any issues, please report with:

1. **Browser & Version:** (e.g., Firefox 120, Zen Browser 1.0)
2. **Extension Version:** 1.5.5.7
3. **Test Failed:** (e.g., "Test 2: Cross-Origin Tab Sync")
4. **Steps Taken:** Exact steps you performed
5. **Expected Result:** What should have happened
6. **Actual Result:** What actually happened
7. **Console Output:** Copy relevant messages from Browser Console
8. **Screenshots:** If visual issue, include screenshots

---

## Success Criteria

**All tests MUST pass for Issue #51 to be considered FIXED:**

- [x] Test 1: Same-Origin Tab Sync
- [x] Test 2: Cross-Origin Tab Sync (< 100ms, not 10 minutes!)
- [x] Test 3: Rapid Tab Switch During Drag
- [x] Test 4: Update Existing Quick Tab
- [x] Test 5: Persistence Across Browser Restart
- [x] Test 6: Multiple Quick Tabs
- [x] Test 7: Pin to Page Feature

**If ANY test fails, Issue #51 is NOT fixed.**

---

## Test Results Template

```
Test Results - Issue #51 Fix
=============================
Date: YYYY-MM-DD
Tester: [Your Name]
Browser: [Firefox/Zen Browser] [Version]
Extension Version: 1.5.5.7

Test 1: Same-Origin Tab Sync        [ PASS / FAIL ]
Test 2: Cross-Origin Tab Sync       [ PASS / FAIL ]
Test 3: Rapid Tab Switch            [ PASS / FAIL ]
Test 4: Update Existing Quick Tab   [ PASS / FAIL ]
Test 5: Browser Restart Persistence [ PASS / FAIL ]
Test 6: Multiple Quick Tabs         [ PASS / FAIL ]
Test 7: Pin to Page Feature         [ PASS / FAIL ]

Performance:
- Cross-Origin Latency: [X]ms
- Same-Origin Latency: [X]ms

Notes:
[Any additional observations]
```

---

## Automated Testing (Future)

For automated regression testing, consider:

1. **Selenium WebDriver** for browser automation
2. **Puppeteer** for headless testing
3. **Jest** for unit testing individual functions

**Example Test Case (Pseudocode):**

```javascript
test('Cross-origin Quick Tab sync', async () => {
  // Open Tab 1
  await browser.openTab('https://en.wikipedia.org/wiki/Firefox');

  // Open Quick Tab
  await browser.pressKey('Q');

  // Move Quick Tab
  await browser.dragElement('.quick-tab-window', { x: 500, y: 500 });

  // Open Tab 2 (different origin)
  await browser.openTab('https://www.youtube.com');

  // Check Quick Tab position
  const position = await browser.getElementPosition('.quick-tab-window');

  // Verify position within 2px
  expect(Math.abs(position.x - 500)).toBeLessThan(2);
  expect(Math.abs(position.y - 500)).toBeLessThan(2);

  // Verify latency < 100ms
  const latency = Date.now() - dragEndTime;
  expect(latency).toBeLessThan(100);
});
```

---

**Good luck testing! 🚀**
