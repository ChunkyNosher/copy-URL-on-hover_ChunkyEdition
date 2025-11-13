# Sidebar Quick Tabs Manager - Testing Guide

**Version:** 1.5.8  
**Feature:** Firefox Sidebar API Integration  
**Date:** 2025-11-12

## Overview

This guide provides step-by-step testing procedures for the new Sidebar Quick Tabs Manager feature implemented in v1.5.8.

## Prerequisites

- Firefox or Zen Browser (latest version recommended)
- Extension loaded in Firefox via `about:debugging` or installed via `.xpi`
- At least 2 Firefox Containers configured (e.g., Personal, Work)

## Test Cases

### Test 1: Basic Sidebar Functionality

**Objective:** Verify sidebar opens and displays Quick Tabs correctly

**Steps:**

1. Load the extension in Firefox
2. Create a Quick Tab by hovering over a link and pressing `Q`
3. Press `Ctrl+Shift+M` (or `Cmd+Shift+M` on Mac) to open sidebar
4. Verify sidebar opens on the right side of the browser window
5. Verify Quick Tab appears in sidebar with:
   - Green indicator (🟢) for active state
   - Correct title and URL
   - Metadata showing position and size
   - Action buttons: 🔗 (Go to Tab), ➖ (Minimize), ✕ (Close)

**Expected Results:**

- ✓ Sidebar opens/closes with keyboard shortcut
- ✓ Quick Tab displayed with correct information
- ✓ Green indicator visible
- ✓ All action buttons present

---

### Test 2: Minimize and Restore

**Objective:** Verify minimizing and restoring Quick Tabs preserves position

**Steps:**

1. Create a Quick Tab at position (300px, 200px) with size 800x600
2. Open sidebar with `Ctrl+Shift+M`
3. Click the ➖ (Minimize) button in the sidebar
4. Verify:
   - Quick Tab disappears from page
   - Sidebar shows Quick Tab with yellow indicator (🟡)
   - Status changes to "Minimized"
   - ↑ (Restore) button appears instead of ➖
5. Click ↑ (Restore) button
6. Verify:
   - Quick Tab reappears at original position (300px, 200px)
   - Quick Tab has original size 800x600
   - Indicator changes back to green (🟢)

**Expected Results:**

- ✓ Position preserved: Quick Tab returns to (300px, 200px)
- ✓ Size preserved: Quick Tab returns to 800x600
- ✓ Not at bottom-right corner (old behavior)

---

### Test 3: Container Tab Separation

**Objective:** Verify Quick Tabs are categorized by Firefox Container

**Steps:**

1. Open a tab in "Personal" container
2. Create a Quick Tab in Personal container
3. Open a tab in "Work" container
4. Create a Quick Tab in Work container
5. Open sidebar
6. Verify:
   - Sidebar shows 2 container sections
   - "Personal" section shows 1 Quick Tab
   - "Work" section shows 1 Quick Tab
   - Each section has container icon and count
7. Switch to "Default" container tab
8. Verify sidebar shows "Default" section if Quick Tabs exist there

**Expected Results:**

- ✓ Quick Tabs grouped by container
- ✓ Container icons displayed (📁, 🔒, 💼, etc.)
- ✓ Tab counts correct for each container
- ✓ No cross-container mixing

---

### Test 4: Go to Tab Feature

**Objective:** Verify "Go to Tab" button switches to correct browser tab

**Steps:**

1. Open Tab 1 and create a Quick Tab
2. Switch to Tab 2 (different page)
3. Open sidebar
4. Verify Quick Tab shows "Tab 1" in metadata
5. Click 🔗 (Go to Tab) button
6. Verify:
   - Browser switches focus to Tab 1
   - Quick Tab is still visible and active

**Expected Results:**

- ✓ Browser switches to correct tab
- ✓ Quick Tab remains active
- ✓ No errors in console

---

### Test 5: Close Minimized Button

**Objective:** Verify "Close Minimized" closes only minimized Quick Tabs

**Steps:**

1. Create 3 Quick Tabs (all active)
2. Minimize 2 of them via sidebar
3. Verify sidebar shows:
   - 1 active Quick Tab (green)
   - 2 minimized Quick Tabs (yellow)
4. Click "Close Minimized" button in sidebar header
5. Verify:
   - 2 minimized Quick Tabs are removed
   - 1 active Quick Tab remains
   - Sidebar updates immediately

**Expected Results:**

- ✓ Only minimized tabs closed
- ✓ Active tab remains
- ✓ Sidebar updates in real-time

---

### Test 6: Close All Button

**Objective:** Verify "Close All" closes all Quick Tabs

**Steps:**

1. Create 3 Quick Tabs (1 active, 2 minimized)
2. Open sidebar
3. Click "Close All" button
4. Verify:
   - All Quick Tabs removed from page
   - Sidebar shows empty state
   - Empty state displays: 📭 "No Quick Tabs"
   - Hint text: "Press Q while hovering over a link to create one"

**Expected Results:**

- ✓ All Quick Tabs closed
- ✓ Empty state displayed
- ✓ No errors in console

---

### Test 7: Cross-Tab Persistence

**Objective:** Verify sidebar state persists across browser tabs

**Steps:**

1. In Tab 1, create 2 Quick Tabs
2. Open sidebar in Tab 1
3. Verify 2 Quick Tabs visible
4. Switch to Tab 2 (different page)
5. Open sidebar in Tab 2
6. Verify:
   - Same 2 Quick Tabs visible
   - Sidebar is ONE instance (not recreated)
   - Minimize a Quick Tab in Tab 2
7. Switch back to Tab 1
8. Verify:
   - Sidebar shows same minimized state
   - No flicker or recreation

**Expected Results:**

- ✓ Sidebar state consistent across tabs
- ✓ ONE instance shared across all tabs
- ✓ No cross-tab sync issues

---

### Test 8: Real-Time Updates

**Objective:** Verify sidebar auto-refreshes as Quick Tabs change

**Steps:**

1. Open sidebar
2. Create a new Quick Tab from the main page (press Q on a link)
3. Observe sidebar (no manual refresh)
4. Verify new Quick Tab appears in sidebar within 2 seconds
5. Close a Quick Tab from the main page (click ✕ button)
6. Verify Quick Tab disappears from sidebar within 2 seconds

**Expected Results:**

- ✓ Sidebar auto-refreshes every 2 seconds
- ✓ New Quick Tabs appear automatically
- ✓ Closed Quick Tabs disappear automatically
- ✓ Last sync timestamp updates

---

### Test 9: Keyboard Shortcut

**Objective:** Verify Ctrl+Shift+M toggles sidebar

**Steps:**

1. With sidebar closed, press `Ctrl+Shift+M`
2. Verify sidebar opens
3. Press `Ctrl+Shift+M` again
4. Verify sidebar closes
5. Test on Mac with `Cmd+Shift+M`

**Expected Results:**

- ✓ Keyboard shortcut toggles sidebar
- ✓ Works on both Windows/Linux and Mac
- ✓ Respects platform modifiers

---

### Test 10: Position Restoration Edge Cases

**Objective:** Verify position restoration handles edge cases

**Steps:**

1. Create Quick Tab at position (1500px, 800px) - far right and bottom
2. Resize browser window to 1024x768 (smaller than Quick Tab position)
3. Minimize Quick Tab
4. Restore Quick Tab
5. Verify Quick Tab appears within viewport (not off-screen)

**Expected Results:**

- ✓ Quick Tab visible after restore
- ✓ Position adjusted if needed to fit viewport
- ✓ No Quick Tab stuck off-screen

---

## Known Issues / Limitations

1. **Sidebar not available on restricted pages** - Firefox/Zen Browser security prevents sidebar on `about:` pages
2. **Container API requires permissions** - Extension needs `contextualIdentities` permission
3. **Fallback behavior** - If Containers not available, all Quick Tabs go to "Default" container

## Regression Tests

Verify these existing features still work:

- [ ] Quick Tab creation with `Q` key
- [ ] Quick Tab drag and move
- [ ] Quick Tab resize
- [ ] Quick Tab pin to page
- [ ] Quick Tab navigation controls
- [ ] Quick Tab slot numbers in debug mode
- [ ] Quick Tab cross-tab sync
- [ ] Firefox Container isolation

## Browser Console Checks

Monitor console for:

- ✓ No error messages during sidebar operations
- ✓ Debug logs show correct container IDs
- ✓ Storage operations complete successfully
- ✓ "Loaded container info" message on sidebar startup
- ✓ "Loaded Quick Tabs state" message on sidebar startup

## Performance Checks

- [ ] Sidebar opens within 500ms
- [ ] Auto-refresh doesn't cause UI lag
- [ ] Minimize/restore operations complete within 100ms
- [ ] No memory leaks after multiple open/close cycles

---

## Sign-Off

**Tested By:** **\*\*\*\***\_**\*\*\*\***  
**Date:** **\*\*\*\***\_**\*\*\*\***  
**Firefox Version:** **\*\*\*\***\_**\*\*\*\***  
**All Tests Passed:** ☐ Yes ☐ No

**Notes:**

---

---

---
