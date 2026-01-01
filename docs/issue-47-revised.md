# Quick Tabs – Comprehensive Behavior Scenarios (v1.6.3+)

**Document Version:** 3.0 (Tab-Scoped)  
**Last Updated:** December 12, 2025  
**Extension Version:** v1.6.3+

---

## Abbreviation Guide

| Code | Meaning            | Example Usage          |
| ---- | ------------------ | ---------------------- |
| WP   | Wikipedia          | WP 1 (Wikipedia Tab 1) |
| YT   | YouTube            | YT 1 (YouTube Tab 1)   |
| GH   | GitHub             | GH 1 (GitHub Tab 1)    |
| TW   | Twitter/X          | TW 1 (Twitter Tab 1)   |
| AM   | Amazon             | AM 1 (Amazon Tab 1)    |
| QT   | Quick Tab          | WP QT 1 (Quick Tab 1)  |
| PM   | Quick Tabs Manager | PM (Sidebar Manager)   |
| FX   | Firefox Container  | FX 1 (Container 1)     |

---

## Notation Guide

**Tab Notation:**

- **"WP 1"** = Wikipedia browser tab number 1 (a regular browser tab, NOT a
  Quick Tab)
- **"YT 2"** = YouTube browser tab number 2

**Quick Tab Notation:**

- **"WP QT 1"** = Quick Tab number 1 created in Wikipedia Tab 1 (content inside
  may vary)
- **"QT 2"** = Quick Tab number 2 (generic, content unspecified)
- Quick Tabs are scoped to their origin tab and do NOT appear in other tabs

**Action Notation:**

- **"Open WP QT 1 in WP 1"** = While viewing Wikipedia Tab 1, create Quick Tab 1
- **"Open YT 1"** = Open a new browser tab, navigate to YouTube
- **"Switch to GH 1"** = Change focus to GitHub Tab 1
- **"Minimize QT 1"** = Hide Quick Tab 1 in the sidebar manager (no DOM)
- **"Restore QT 1"** = Show Quick Tab 1 again from the sidebar

**Important Clarifications:**

- If you open WP 1, then open YT (a new tab), that YouTube tab is **YT 1**, NOT
  YT 2
- Tab numbering is per-domain and sequential: first WP tab = WP 1, second WP tab
  = WP 2, first YT tab = YT 1, etc.
- Quick Tab numbering is sequential globally: first QT opened = QT 1, second =
  QT 2, etc.
- **Quick Tabs are tab-scoped:** A Quick Tab created in WP 1 will ONLY appear in
  WP 1, never in YT 1 or GH 1
- **Manager shows all tabs:** The sidebar manager displays Quick Tabs from all
  browser tabs, grouped by origin tab

**Symbols:**

- **⇨** = Action leads to expected result
- **🌐** = Quick Tab appears in sidebar manager

---

## Scenario 1: Basic Quick Tab Creation & Tab Isolation

**Purpose:** Verify that Quick Tabs are created correctly and remain isolated to
their origin tab.

### Steps:

1. **Open WP 1**
   - Action: Launch browser, navigate to Wikipedia Main Page
   - Expected: WP 1 loads successfully

2. **Open WP QT 1 in WP 1**
   - Action: While viewing WP 1, press Q (keyboard shortcut) to create Quick Tab
   - Expected: WP QT 1 appears as floating window in WP 1 with default position
     and size

3. **Verify QT 1 visible only in WP 1**
   - Action: Observe Quick Tab in viewport
   - Expected: QT 1 is visible, draggable, resizable, with toolbar showing all
     controls (back, forward, reload, minimize, close)

4. **Switch to YT 1 (new tab)**
   - Action: Open new browser tab, navigate to YouTube
   - Expected: YT 1 loads successfully

5. **Verify QT 1 does NOT appear in YT 1**
   - Action: Observe YT 1 viewport for any Quick Tabs
   - Expected: QT 1 is NOT visible in YT 1 (tab isolation confirmed - QT 1
     belongs to WP 1 only)

---

## Scenario 2: Multiple Quick Tabs in Single Tab (No Cross-Tab Sync)

**Purpose:** Verify that multiple Quick Tabs created in one tab stay in that tab
and don't sync to other tabs.

### Steps:

1. **Open WP 1, open WP QT 1 & QT 2**
   - Action: Navigate to Wikipedia, press Q twice to create two Quick Tabs
   - Expected: Both QT 1 and QT 2 appear in WP 1 at default positions

2. **Verify both QTs visible in WP 1**
   - Action: Observe viewport
   - Expected: QT 1 and QT 2 are both visible, each with independent
     position/size

3. **Open GH 1 (new tab)**
   - Action: Open new browser tab, navigate to GitHub
   - Expected: GH 1 loads successfully

4. **Verify QTs do NOT appear in GH 1**
   - Action: Observe GH 1 viewport
   - Expected: Neither QT 1 nor QT 2 appear in GH 1 (no cross-tab sync)

5. **Switch back to WP 1**
   - Action: Click WP 1 tab
   - Expected: Both QT 1 and QT 2 still visible in WP 1 (no changes)

---

## Scenario 3: Position/Size Persistence Within Single Tab

**Purpose:** Verify that moving and resizing Quick Tabs persists within the same
tab across page reloads.

### Steps:

1. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q to create Quick Tab
   - Expected: QT 1 appears at default position (e.g., 100px, 100px, 800px ×
     600px)

2. **Move and resize QT 1**
   - Action: Drag QT 1 to (300px, 200px), resize to 600px × 400px
   - Expected: QT 1 moves/resizes, position/size saved to storage
     (originTabId=1)

3. **Reload WP 1 (hard refresh)**
   - Action: Press Ctrl+Shift+R
   - Expected: Page reloads

4. **Verify QT 1 restored with saved position/size**
   - Action: Observe QT 1 after page reload
   - Expected: QT 1 reappears at (300px, 200px) with 600px × 400px size
     (persistence confirmed)

5. **Verify position/size is local to this tab**
   - Action: Open GH 1 (new tab)
   - Expected: GH 1 loads with no QTs (no position/size sync to other tabs)

---

## Scenario 4: Quick Tabs Manager - Display Grouped by Origin Tab

**Purpose:** Verify Manager Panel displays Quick Tabs grouped by their origin
tab with clear labeling.

### Steps:

1. **Open WP 1, create WP QT 1 & QT 2**
   - Action: Navigate to Wikipedia, press Q twice
   - Expected: QT 1 and QT 2 created in WP 1

2. **Open YT 1, create YT QT 3**
   - Action: Open YouTube tab, press Q
   - Expected: QT 3 created in YT 1

3. **Open Manager Panel (Sidebar)**
   - Action: Press Ctrl+Alt+Z (or extension button)
   - Expected: Manager appears showing tabs grouped as:
     - "Wikipedia Tab 1" section: QT 1, QT 2
     - "YouTube Tab 1" section: QT 3

4. **Observe Manager grouping clarity**
   - Action: Check Manager display
   - Expected: Each Quick Tab shows its origin tab, minimized state indicator
     (green 🟢 active, yellow 🟡 minimized), and action buttons

5. **Switch to GH 1 and verify Manager still shows all tabs**
   - Action: Open GitHub tab, open Manager
   - Expected: Manager still shows all Quick Tabs grouped by origin (WP 1, YT
     1), no QTs created in GH 1

---

## Scenario 5: Minimize Quick Tab in Single Tab

**Purpose:** Verify minimizing a Quick Tab hides it locally and shows it in the
Manager.

### Steps:

1. **Open WP 1, create WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 visible in WP 1

2. **Minimize QT 1 via toolbar**
   - Action: Click minimize button (−) on QT 1
   - Expected: QT 1 disappears from viewport, status changes to minimized
     (yellow 🟡)

3. **Open Manager and verify QT 1 listed**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows QT 1 under "Wikipedia Tab 1" with yellow 🟡
     minimized indicator and "Restore" button

4. **Restore QT 1 from Manager**
   - Action: Click restore button (↑) next to QT 1
   - Expected: QT 1 reappears in WP 1 at last known position, status changes to
     active (green 🟢)

5. **Verify no impact on other tabs**
   - Action: Switch to YT 1
   - Expected: YT 1 has no Quick Tabs (minimize/restore is local to WP 1)

---

## Scenario 6: Close Single Quick Tab

**Purpose:** Verify closing a Quick Tab removes it from the current tab and
Manager.

### Steps:

1. **Open WP 1, create WP QT 1 & QT 2**
   - Action: Navigate to Wikipedia, press Q twice
   - Expected: QT 1 and QT 2 visible in WP 1

2. **Close QT 1**
   - Action: Click close button (✕) on QT 1
   - Expected: QT 1 immediately closes and disappears

3. **Verify QT 2 remains**
   - Action: Observe WP 1
   - Expected: QT 2 still visible in WP 1

4. **Open Manager and verify QT 1 removed**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows only QT 2 under "Wikipedia Tab 1", no QT 1

5. **Switch to other tabs and verify isolation**
   - Action: Open YT 1
   - Expected: YT 1 has no QTs (closing is local to WP 1)

---

## Scenario 7: Close All Quick Tabs via Manager

**Purpose:** Verify "Close All" button in Manager closes all Quick Tabs across
all tabs.

### Steps:

1. **Create Quick Tabs across multiple tabs**
   - Action: Open WP 1 and create QT 1, open YT 1 and create QT 2, open GH 1 and
     create QT 3
   - Expected: Three Quick Tabs created (one per tab)

2. **Open Manager**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows three sections: "Wikipedia Tab 1" (QT 1), "YouTube
     Tab 1" (QT 2), "GitHub Tab 1" (QT 3)

3. **Click "Close All" button**
   - Action: Click "Close All" in Manager header
   - Expected: All three QTs immediately close, Manager shows "No Quick Tabs"
     message

4. **Verify QTs closed in WP 1**
   - Action: Switch to WP 1
   - Expected: No Quick Tabs visible

5. **Verify QTs closed in other tabs**
   - Action: Switch to YT 1, then GH 1
   - Expected: No Quick Tabs in either tab (global close confirmed)

---

## Scenario 8: Close All Minimized Quick Tabs via Manager

**Purpose:** Verify "Close Minimized" button closes only minimized Quick Tabs
while preserving visible ones.

### Steps:

1. **Create and manage Quick Tabs state**
   - Action: Open WP 1, create QT 1 & QT 2; minimize QT 1; open YT 1, create QT
     3 & QT 4; minimize QT 3
   - Expected: WP 1 has visible QT 2, minimized QT 1; YT 1 has visible QT 4,
     minimized QT 3

2. **Open Manager**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows all 4 QTs with indicators (QT 1 & QT 3 yellow 🟡,
     QT 2 & QT 4 green 🟢)

3. **Click "Close Minimized" button**
   - Action: Click "Close Minimized" in Manager
   - Expected: QT 1 and QT 3 close, QT 2 and QT 4 remain

4. **Verify visible tabs unaffected**
   - Action: Switch to WP 1
   - Expected: QT 2 still visible, QT 1 gone

5. **Verify YT 1 state**
   - Action: Switch to YT 1
   - Expected: QT 4 still visible, QT 3 gone

---

## Scenario 9: Quick Tab Limit Enforcement Per Tab

**Purpose:** Verify that maximum Quick Tab limit is enforced and prevents
exceeding the limit.

### Steps:

1. **Set max Quick Tabs to 2 in settings**
   - Action: Open extension settings, set "Max Quick Tabs" to 2
   - Expected: Setting saved

2. **Create 2 Quick Tabs in WP 1**
   - Action: Open WP 1, press Q twice to create QT 1 & QT 2
   - Expected: Both QTs created successfully (2/2 limit reached)

3. **Try to create 3rd Quick Tab in WP 1**
   - Action: Press Q again in WP 1
   - Expected: Notification appears: "Maximum Quick Tabs limit reached (2/2)",
     QT 3 NOT created

4. **Create 2 new Quick Tabs in YT 1 (separate tab)**
   - Action: Open YT 1, press Q twice to create QT 3 & QT 4
   - Expected: Both QTs created successfully in YT 1 (limit applies per-tab, WP
     1 limit doesn't affect YT 1)

5. **Verify total of 4 Quick Tabs in Manager**
   - Action: Open Manager
   - Expected: Shows "Wikipedia Tab 1" (QT 1, QT 2) and "YouTube Tab 1" (QT 3,
     QT 4)

---

## Scenario 10: Quick Tab Persistence Across Browser Restart

**Purpose:** Verify Quick Tab state (position, size, minimized status) persists
after browser close and reopen.

### Steps:

1. **Create and configure Quick Tabs**
   - Action: Open WP 1, create QT 1; position at (200px, 300px), resize to 700px
     × 500px; keep visible
   - Expected: QT 1 configured and stored

2. **Create and minimize Quick Tab in another tab**
   - Action: Open YT 1, create QT 2; minimize it
   - Expected: QT 2 minimized (yellow 🟡)

3. **Close browser completely**
   - Action: File → Quit (or Alt+F4)
   - Expected: Browser closes, all state saved to storage

4. **Reopen browser, navigate to WP 1**
   - Action: Launch browser, open Wikipedia
   - Expected: QT 1 automatically restores at (200px, 300px) with 700px × 500px
     size, visible (green 🟢)

5. **Verify YT 1 state persisted**
   - Action: Open YouTube
   - Expected: QT 2 NOT visible in viewport (minimized state persisted); open
     Manager to confirm QT 2 listed with yellow 🟡

---

## Scenario 11: Hydration on Page Reload (originTabId Filtering)

**Purpose:** Verify Quick Tabs are restored on page reload only for the current
tab, not other tabs.

### Steps:

1. **Open WP 1, create WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 visible in WP 1

2. **Open YT 1, verify no sync**
   - Action: Open YouTube in new tab
   - Expected: YT 1 loads, QT 1 NOT visible (no cross-tab sync)

3. **Reload WP 1 page**
   - Action: Press Ctrl+R in WP 1
   - Expected: Page reloads

4. **Verify QT 1 restored in WP 1**
   - Action: Observe WP 1 after reload
   - Expected: QT 1 automatically restores (hydration via originTabId filter:
     stored originTabId=1 matches current tab ID=1)

5. **Verify YT 1 still has no QTs**
   - Action: Switch to YT 1
   - Expected: YT 1 has no Quick Tabs (hydration filtered out QT 1 because
     originTabId=1 ≠ currentTabId=2)

---

## Scenario 12: Tab Closure and State Management

**Purpose:** Verify that closing a browser tab removes its Quick Tabs from the
Manager without affecting other tabs.

### Steps:

1. **Create Quick Tabs in multiple tabs**
   - Action: Open WP 1 and create QT 1 & QT 2; open YT 1 and create QT 3; open
     GH 1 and create QT 4
   - Expected: Four QTs created across three tabs

2. **Open Manager**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows all tabs grouped: WP 1 (QT 1, QT 2), YT 1 (QT 3),
     GH 1 (QT 4)

3. **Close YT 1 tab**
   - Action: Close the YouTube tab
   - Expected: YT 1 tab closes

4. **Verify Manager updates automatically**
   - Action: Observe Manager (stays open in remaining tab)
   - Expected: Manager now shows only: WP 1 (QT 1, QT 2), GH 1 (QT 4); YT 1
     section removed

5. **Verify remaining tabs unaffected**
   - Action: Switch to WP 1
   - Expected: QT 1 and QT 2 still visible; no changes

---

## Scenario 13: Position/Size Changes Don't Affect Other Tabs

**Purpose:** Verify moving/resizing Quick Tab in one tab does NOT affect
same-numbered QTs in other tabs.

### Steps:

1. **Create Quick Tabs in two tabs**
   - Action: Open WP 1, create QT 1 at (100px, 100px); open YT 1, create QT 2 at
     (200px, 200px)
   - Expected: Two QTs at different positions (note: QT 1 in WP 1, QT 2 in YT 1)

2. **Move QT 1 in WP 1**
   - Action: Drag QT 1 in WP 1 to (500px, 500px)
   - Expected: QT 1 in WP 1 moves to new position, storage updated with
     originTabId=1

3. **Switch to YT 1 and check QT 2**
   - Action: Click YT 1 tab
   - Expected: QT 2 remains at (200px, 200px) (no sync from WP 1 QT 1)

4. **Resize QT 2 in YT 1**
   - Action: Drag bottom-right corner of QT 2 to 600px × 400px
   - Expected: QT 2 resizes, storage updated with originTabId=2

5. **Switch back to WP 1 and verify**
   - Action: Click WP 1 tab
   - Expected: QT 1 still at (500px, 500px) with unchanged size (no sync from YT
     1 QT 2)

---

## Scenario 14: Container Isolation (Firefox Multi-Account Container)

**Purpose:** Verify Quick Tabs respect Firefox container boundaries and are
isolated by container.

### Steps:

1. **Open WP 1 in FX 1 (default container), create WP QT 1**
   - Action: Navigate to Wikipedia in default container, press Q
   - Expected: QT 1 created in default container

2. **Open WP 2 in FX 2 (Personal container), create WP QT 2**
   - Action: Right-click new tab → "Personal" container, navigate to Wikipedia,
     press Q
   - Expected: QT 2 created in Personal container

3. **Open Manager in WP 1 (FX 1 context)**
   - Action: Press Ctrl+Alt+Z in WP 1
   - Expected: Manager shows only QT 1 under "Wikipedia Tab" (FX 1 default
     container)

4. **Verify QT 1 doesn't appear in FX 2**
   - Action: Switch to WP 2 (Personal container)
   - Expected: QT 1 NOT visible in WP 2 (container isolation enforced)

5. **Verify Manager in FX 2 shows only QT 2**
   - Action: Press Ctrl+Alt+Z in WP 2
   - Expected: Manager shows only QT 2 under "Wikipedia Tab" (FX 2 Personal
     container)

---

## Scenario 15: Multiple Quick Tabs in One Tab with Dragging & Layering

**Purpose:** Verify multiple Quick Tabs can overlap, be dragged independently,
and use correct z-index layering.

### Steps:

1. **Open WP 1, create WP QT 1, QT 2, QT 3**
   - Action: Navigate to Wikipedia, press Q three times
   - Expected: QT 1, QT 2, QT 3 visible in WP 1 (QT 3 created last, on top by
     default)

2. **Click on QT 1 (partially covered by QT 3)**
   - Action: Click QT 1 title bar
   - Expected: QT 1 z-index increases, moves to front, overlaps QT 2 and QT 3

3. **Drag QT 1 to new position**
   - Action: Drag QT 1 to bottom-right corner
   - Expected: QT 1 moves smoothly, remains on top

4. **Click on QT 2**
   - Action: Click QT 2 title bar
   - Expected: QT 2 z-index increases, brings QT 2 to front

5. **Verify Manager shows all three QTs**
   - Action: Open Manager
   - Expected: Manager shows all three QTs under "Wikipedia Tab 1" with correct
     count (3 total, all green 🟢 active)

---

## Scenario 16: Manager Panel Position Persistence

**Purpose:** Verify Manager Panel's own position and size persist across tab
switches within the same session.

### Steps:

1. **Open WP 1, create WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 visible

2. **Open Manager at default position**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager appears at default position (top-right, 350px × 500px)

3. **Move and resize Manager**
   - Action: Drag Manager to bottom-left (20px, calc(100vh - 520px)); resize to
     450px × 600px
   - Expected: Manager moves/resizes as specified

4. **Switch to YT 1 (new tab)**
   - Action: Open YouTube, Manager still open
   - Expected: Manager stays at bottom-left with 450px × 600px (position
     persists across tab switch in same session)

5. **Close and reopen Manager**
   - Action: Close Manager (click ✕), then press Ctrl+Alt+Z to reopen
   - Expected: Manager appears at last saved position (bottom-left, 450px ×
     600px)

---

## Scenario 17: Rapid Tab Switching with Quick Tab State

**Purpose:** Verify Quick Tab state remains correct during rapid tab switching
(emergency save mechanism).

### Steps:

1. **Create Quick Tabs in two tabs**
   - Action: Open WP 1, create QT 1 at (100px, 100px); open YT 1, create QT 2 at
     (200px, 200px)
   - Expected: QTs created at specified positions

2. **Start dragging QT 1 in WP 1**
   - Action: Begin dragging QT 1 towards (400px, 400px)
   - Expected: QT 1 begins moving

3. **Rapidly switch to YT 1 (within 100ms)**
   - Action: Click YT 1 tab while drag operation is in progress
   - Expected: Tab switch triggers emergency save, position saved before
     switching

4. **Switch back to WP 1**
   - Action: Click WP 1 tab
   - Expected: QT 1 position at (400px, 400px) (saved despite rapid switch)

5. **Verify storage persistence**
   - Action: Reload WP 1
   - Expected: QT 1 restores at (400px, 400px) (emergency save persisted)

---

## Scenario 18: Quick Tab Visibility Across Container Context

**Purpose:** Verify Quick Tabs created in one container are not visible when
switching to a different container on the same domain.

### Steps:

1. **Open GitHub in FX 1 (default container), create QT 1**
   - Action: Navigate to GitHub in default container, press Q
   - Expected: QT 1 visible in GH 1 (FX 1)

2. **Open GitHub in FX 2 (Work container)**
   - Action: Right-click new tab → "Work" container, navigate to GitHub
   - Expected: GH 2 opens in Work container

3. **Verify QT 1 not visible in GH 2**
   - Action: Observe GH 2 viewport
   - Expected: QT 1 NOT visible (container isolation: originTabId=GH 1,
     currentTabId=GH 2, different containers)

4. **Create QT 2 in GH 2 (FX 2)**
   - Action: Press Q in GH 2
   - Expected: QT 2 created in FX 2 context

5. **Open Manager and verify grouping**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows two separate "GitHub Tab" sections (one per
     container) with QT 1 and QT 2 listed separately

---

## Scenario 19: Minimize and Restore Cycle in One Tab

**Purpose:** Verify minimize/restore state machine transitions correctly within
a single tab.

### Steps:

1. **Open WP 1, create WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 visible (green 🟢 active)

2. **Minimize QT 1**
   - Action: Click minimize button (−)
   - Expected: QT 1 disappears from viewport, status becomes yellow 🟡 minimized

3. **Restore QT 1 from Manager**
   - Action: Press Ctrl+Alt+Z, click restore (↑) button
   - Expected: QT 1 reappears in WP 1, status becomes green 🟢 active

4. **Minimize and restore again rapidly**
   - Action: Click minimize (−), then immediately click restore (↑)
   - Expected: Both operations complete successfully (state machine handles
     transitions correctly)

5. **Verify final state**
   - Action: Observe QT 1
   - Expected: QT 1 visible (green 🟢), position/size unchanged from original

---

## Scenario 20: Cross-Domain Navigation in Same Tab

**Purpose:** Verify Quick Tabs persist when navigating to a different domain in
the same tab, and hydrate on page reload.

### Steps:

1. **Open WP 1, create WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 visible at (100px, 100px)

2. **Navigate to different domain in same tab**
   - Action: Navigate to YouTube in WP 1 (type URL directly in address bar)
   - Expected: Page changes to YouTube, QT 1 remains visible

3. **Note QT 1 visibility during navigation**
   - Action: Observe if QT 1 persists or momentarily disappears
   - Expected: QT 1 may disappear briefly during page reload (cross-domain
     navigation)

4. **Wait for new page to fully load**
   - Action: Wait for YouTube page to complete loading
   - Expected: Content script reinitializes, hydration checks originTabId

5. **Verify QT 1 restored after load**
   - Action: Observe WP 1 after YouTube page loads
   - Expected: QT 1 reappears at (100px, 100px) (hydration restored it because
     originTabId=1 matches current tab)

---

## Scenario 21: Memory and Storage Impact of Multiple Quick Tabs

**Purpose:** Verify that creating many Quick Tabs doesn't cause memory issues
and storage remains bounded.

### Steps:

1. **Create 10 Quick Tabs in WP 1**
   - Action: Open WP 1, press Q repeatedly (10 times) with brief pauses between
   - Expected: All 10 QTs created, each numbered QT 1–QT 10

2. **Verify Manager shows all 10**
   - Action: Open Manager
   - Expected: Manager displays all 10 QTs under "Wikipedia Tab 1" (may require
     scrolling)

3. **Monitor extension memory usage**
   - Action: Open Firefox about:debugging → Extension memory usage
   - Expected: Memory usage is reasonable (no massive spikes)

4. **Check storage size**
   - Action: Check browser.storage.local via console:
     `await browser.storage.local.get('quick_tabs_state_v2')`
   - Expected: Storage contains all 10 tabs, size is reasonable (<1MB for state)

5. **Close 5 Quick Tabs and verify cleanup**
   - Action: Close QT 1 through QT 5
   - Expected: Manager now shows only QT 6–QT 10 (5 tabs removed), storage size
     decreases

---

## Implementation Notes for Testing

### Test Bridge API Usage

All scenarios can be tested programmatically using the Test Bridge API with
`TEST_MODE=true`:

```javascript
// Example test code
await window.__COPILOT_TEST_BRIDGE__.createQuickTab('https://example.com');
const tabs = await window.__COPILOT_TEST_BRIDGE__.getQuickTabsInCurrentTab();
expect(tabs).toHaveLength(1);
```

### Cross-Tab Testing

Use Playwright's multi-page context to simulate multiple browser tabs:

```javascript
const page1 = await context.newPage(); // Tab A
const page2 = await context.newPage(); // Tab B
// Create QT in page1, verify it doesn't appear in page2
```

### Container Testing

Firefox containers require specific profile configuration in Playwright
fixtures.

### Timing Considerations

- Extension initialization: 1-2 seconds
- Hydration from storage: 100-300ms
- Manager updates: 50-200ms
- Storage write/read: 50-200ms
- Allow 500-1000ms wait after operations for state persistence

### State Verification Checklist

Before marking scenario as PASS:

- [ ] Quick Tab appears in correct tab (not others)
- [ ] Manager shows correct grouping by origin tab
- [ ] Position/size persists when expected
- [ ] Minimized state displayed correctly
- [ ] No data leakage to other tabs
- [ ] Storage contains correct originTabId
- [ ] Cross-domain navigation handled correctly
- [ ] Container boundaries respected

---

## v1.6.4 User Feedback Bugs (December 2025)

**Added from User Feedback:** December 30, 2025

### Bug 1b: Click to Bring Quick Tab to Front (FIXED)

**Issue:** Clicking inside a Quick Tab's content area didn't bring it to front.
**Fix:** Added transparent click overlay with `MAX_OVERLAY_Z_INDEX` constant
(2147483646) and `OVERLAY_REACTIVATION_DELAY_MS` (500ms) for pointer-events
toggling. The overlay captures mousedown events, brings window to front via
`onFocus()`, and temporarily disables pointer-events to allow click
pass-through. **Status:** ✅ FIXED in v1.6.4

### Bug 2b: "Open in New Tab" Button Broken (FIXED)

**Issue:** Both Quick Tab UI button and Manager button didn't work. **Root
Cause:** `openTab` action was missing from `VALID_MESSAGE_ACTIONS` allowlist in
MessageRouter.js. **Fix:** Added `openTab`, `saveQuickTabState`,
`getQuickTabState`, `clearQuickTabState`, `createQuickTab` to allowlist.
**Status:** ✅ FIXED in v1.6.4

### Bug 3b: Cross-Tab Transfer/Duplicate Not Working (FIXED)

**Issue:** Dragging Quick Tabs between tabs didn't trigger transfer/duplicate.
**Root Cause:** Target tabs without Quick Tabs may not have a port connection.
**Fix:** Added fallback messaging via `browser.tabs.sendMessage` when port is
unavailable. Added `_sendTransferInMessageFallback()` and
`_sendDuplicateMessageFallback()` in background.js. Added handlers for
`QUICK_TAB_TRANSFERRED_IN`, `QUICK_TAB_TRANSFERRED_OUT`, and
`CREATE_QUICK_TAB_FROM_DUPLICATE` in content.js TYPE_HANDLERS. **Status:** ✅
FIXED in v1.6.4

### Bug 4b: Manager Reordering Resets (FIXED)

**Issue:** Reordering tabs/Quick Tabs in Manager reverted after operations.
**Fix:** Added `_userGroupOrder` persistence and enhanced
`_applyUserGroupOrder()` with stricter numeric type validation. Extracted
`_findMatchingGroupKey()` helper. **Status:** ✅ FIXED in v1.6.4

### Bug 5b: Alt Key Modifier Not Working (FIXED)

**Issue:** Alt key for duplicate on drag didn't work. **Fix:** Removed Alt from
options, changed default to Shift key. **Status:** ✅ FIXED in v1.6.4

---

## v1.6.4 New Features (December 2025)

### Feature 1: Drag-and-Drop Reordering

**Description:** Users can reorder tabs and Quick Tabs in Manager via
drag-and-drop. **Implementation:** Added `attachDragDropEventListeners()` with
tab group and Quick Tab item handlers. **Status:** ✅ IMPLEMENTED in v1.6.4

### Feature 2: Cross-Tab Quick Tab Transfer

**Description:** Drag Quick Tab from one tab group to another to transfer it.
**Implementation:** `TRANSFER_QUICK_TAB` message type handled by background.js.
**Status:** ✅ IMPLEMENTED in v1.6.4

### Feature 3: Duplicate via Shift+Drag

**Description:** Hold Shift key while dragging to duplicate instead of move.
**Implementation:** `DUPLICATE_QUICK_TAB` message type with configurable
modifier key. **Settings:** Duplicate Modifier Key dropdown (Shift default,
Ctrl, None). **Status:** ✅ IMPLEMENTED in v1.6.4

### Feature 4: Move to Current Tab Button

**Description:** Replaces "Go to Tab" button for Quick Tab items - moves Quick
Tab to current active browser tab. **Implementation:** `moveToCurrentTab` action
with `_dispatchMoveToCurrentTab()` handler. **Status:** ✅ IMPLEMENTED in v1.6.4

### Feature 5: Tab Group Actions

**Description:** Added "Go to Tab" and "Close All in Tab" buttons for each tab
group header. **Implementation:** `_createGroupActions()` function with button
handlers. **Status:** ✅ IMPLEMENTED in v1.6.4

### Feature 6: Open in New Tab Button (Manager)

**Description:** Added "Open in New Tab" button per Quick Tab in Manager.
**Implementation:** `_handleOpenInNewTab()` function using `openTab` action.
**Status:** ✅ IMPLEMENTED in v1.6.4

### Feature 7: Count Indicator Styling

**Description:** Smaller container with bigger number for Quick Tab count
indicator. **CSS Changes:** font-size: 11px → 13px, padding: 4px 10px → 2px 6px.
**Status:** ✅ IMPLEMENTED in v1.6.4

---

## v1.6.4 Bug Fixes (December 2025)

**Added from User Feedback:** December 31, 2025

### Bug 1c & 2c: Transferred/Duplicated Quick Tabs Not Appearing (FIXED)

**Issue:** Quick Tabs transferred or duplicated via drag-and-drop didn't appear
in Manager. **Root Cause:** Redundant `requestAllQuickTabsViaPort()` calls
caused race conditions - STATE_CHANGED message already contains the correct
updated state. **Fix:** Removed redundant `requestAllQuickTabsViaPort()` calls
after transfer/duplicate operations. STATE_CHANGED push notification from
background is sufficient. **Status:** ✅ FIXED in v1.6.4

### Bug 3c: Quick Tab Reordering Within Groups Resets (FIXED)

**Issue:** Reordering Quick Tabs within a tab group via drag-and-drop would
reset when state changes occurred. **Root Cause:** No persistence of user's
Quick Tab order within groups. **Fix:** Added `_userQuickTabOrderByGroup` map
(originTabId → quickTabId array) for per-group ordering. Added
`QUICK_TAB_ORDER_STORAGE_KEY` ('quickTabsManagerQuickTabOrder') for persistence.
Added `_applyUserQuickTabOrder()` to preserve order during renders. Added
`_saveUserQuickTabOrder()` to capture DOM order after reorder. **Status:** ✅
FIXED in v1.6.4

### Bug 4c: Last Quick Tab Close Not Reflected in Manager (FIXED)

**Issue:** Closing the last Quick Tab in a tab group didn't properly update the
Manager UI to show empty state. **Root Cause:** Edge case handling for
transitioning to empty state was missing. **Fix:** Extracted
`_handleEmptyStateTransition()` helper for handling last Quick Tab close
scenarios. Added `_logLowQuickTabCount()` for monitoring when Quick Tab count
drops to low values (0-1). **Status:** ✅ FIXED in v1.6.4

---

## v1.6.4-v2 Bug Fixes (January 2026)

**Added from User Feedback:** January 1, 2026

### Bug 1d: Quick Tab Title Shows Link Text Instead of Page Title (FIXED)

**Issue:** When opening a Quick Tab of a link, the title shows the link text
(e.g., "11th most populous country") instead of the actual page title (e.g.,
"List of countries and dependencies by population - Wikipedia"). **Root Cause:**
Title was set from `targetElement.textContent` in content.js line 3550 and never
updated after iframe loaded. **Fix:** Modified
`_notifyBackgroundOfStateChange()` in window.js to send UPDATE_QUICK_TAB message
with both URL and title when iframe loads. Background updates session state and
sends STATE_CHANGED to sidebar. **Status:** ✅ FIXED in v1.6.4-v2

### Bug 2d: "Move to Current Tab" Quick Tab Doesn't Appear in Manager (FIXED)

**Issue:** After pressing "Move to Current Tab" button in Manager, the Quick Tab
transfers to the active tab and appears on screen, but doesn't appear in the
Manager and doesn't respond to "Close All" button. **Root Cause:** State version
race condition during render - when ACK triggers `_forceImmediateRender()`,
STATE_CHANGED may arrive during render, but the render completion was setting
`_lastRenderedStateVersion = _stateVersion` after it had already been
incremented. **Fix:** Added `stateVersionAtRenderStart` capture at beginning of
render, updated `_lastRenderedStateVersion` to use captured version. Extracted
`_updateRenderTrackers()` helper. **Status:** ✅ FIXED in v1.6.4-v2

### Bug 3d: Last Quick Tab Close Not Reflected in Manager (FIXED)

**Issue:** When closing all Quick Tabs one by one via UI close button, the last
Quick Tab closes on screen but still appears in Manager. **Root Cause:**
VisibilityHandler's `_persistToStorage()` was calling `persistStateToStorage()`
without `forceEmpty=true` when state had 0 tabs, causing the empty write to be
blocked. **Fix:** Modified VisibilityHandler's `_persistToStorage()` to detect
when `state.tabs.length === 0` and pass `forceEmpty=true` to allow empty state
writes. **Status:** ✅ FIXED in v1.6.4-v2

### Bug 4d: Manager Doesn't Update When Navigating Within Quick Tab (FIXED)

**Issue:** When user clicks a different link inside a Quick Tab iframe
(navigation), the Manager doesn't update to show the new page title. **Root
Cause:** The iframe load handler in window.js updated local titlebar but didn't
send UPDATE_QUICK_TAB message to background. **Fix:** Modified
`setupIframeLoadHandler()` to capture previous title, compare with new title,
and send UPDATE_QUICK_TAB message if either URL or title changed. **Status:** ✅
FIXED in v1.6.4-v2

### Bug 5d: "Open in New Tab" Button Doesn't Close Quick Tab (FIXED)

**Issue:** Clicking "Open in New Tab" button in Manager opens the URL in a new
browser tab correctly, but doesn't close the Quick Tab from the origin tab or
remove it from Manager. **Root Cause:** `_handleOpenInNewTab()` only opened the
URL but didn't trigger a close operation. **Fix:** Added
`closeQuickTabViaPort(quickTabId)` call after successfully opening URL in new
tab. Added logging for the close operation. **Status:** ✅ FIXED in v1.6.4-v2

---

## v1.6.4-v2 Code Health Refactoring (January 2026)

### window.js Refactoring (Code Health: 8.28 → 9.38)

- Extracted 8 helpers from `_createClickOverlay` (CC=12 → resolved)
- Extracted 2 helpers from `_tryGetIframeUrl` (CC=10 → resolved)
- Extracted 2 predicate helpers for complex conditionals

### VisibilityHandler.js Refactoring (Code Health: 8.28 → 9.38)

- Extracted 4 helpers from `_validateContainerForOperation` (CC=13 → resolved)
- Extracted 2 helpers from `handleFocus` (CC=9 → resolved)

### quick-tabs-manager.js Refactoring

- Created `StorageChangeAnalyzer.js` module with 20 extracted functions
- Reduced function count from 367 to 347

---

**End of Scenarios Document**

**Document Maintainer:** ChunkyNosher  
**Repository:** https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Last
Review Date:** January 1, 2026  
**Behavior Model:** Tab-Scoped (v1.6.4-v2)
