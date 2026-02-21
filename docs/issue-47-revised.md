# Quick Tabs – Comprehensive Behavior Scenarios (v1.6.4+)

**Document Version:** 4.4 (v1.6.4-v5 Additional Bug Fixes)  
**Last Updated:** January 5, 2026  
**Extension Version:** v1.6.4-v5

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

## Scenario 22: Move to Current Tab with Manager Update (v1.6.4-v3)

**Purpose:** Verify "Move to Current Tab" button properly transfers Quick Tab
and updates Manager.

### Steps:

1. **Setup: Create Quick Tab in Tab A**
   - Action: Open WP 1, press Q to create QT 1
   - Expected: QT 1 visible in WP 1

2. **Open second tab and switch to it**
   - Action: Open YT 1 (new tab), switch to YT 1
   - Expected: YT 1 is active, no Quick Tabs visible

3. **Open Manager from YT 1**
   - Action: Press Ctrl+Alt+Z in YT 1
   - Expected: Manager opens, shows QT 1 under "Wikipedia Tab 1"

4. **Click "Move to Current Tab" on QT 1**
   - Action: Find QT 1 in Manager, click "Move to Current Tab" button (⟵ icon)
   - Expected: QT 1 appears visually in YT 1 viewport

5. **Verify Manager updates immediately**
   - Action: Observe Manager UI
   - Expected: QT 1 now appears under "YouTube Tab 1" (not "Wikipedia Tab 1")

6. **Verify "Close All" works on transferred Quick Tab**
   - Action: Click "Close All" button in Manager
   - Expected: QT 1 closes from YT 1, Manager shows empty state

---

## Scenario 23: Drag Transfer with Manager Update (v1.6.4-v3)

**Purpose:** Verify dragging Quick Tab between tab groups updates Manager
correctly.

### Steps:

1. **Setup: Create Quick Tab in Tab A**
   - Action: Open WP 1, press Q to create QT 1
   - Expected: QT 1 visible in WP 1

2. **Open second tab**
   - Action: Open YT 1 (new tab)
   - Expected: YT 1 loads, two browser tabs exist

3. **Open Manager**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows QT 1 under "Wikipedia Tab 1" and "YouTube Tab 1"
     group header (may be empty)

4. **Drag QT 1 from WP 1 group to YT 1 group (without Shift)**
   - Action: Drag QT 1 item from "Wikipedia Tab 1" section to "YouTube Tab 1"
     section header (drop zone)
   - Expected: QT 1 transfers to YT 1

5. **Verify Manager shows transfer immediately**
   - Action: Observe Manager UI
   - Expected: QT 1 now appears under "YouTube Tab 1", "Wikipedia Tab 1" section
     shows empty or is removed

6. **Verify Quick Tab appears in YT 1 viewport**
   - Action: Switch to YT 1 tab
   - Expected: QT 1 visible in YT 1 viewport

7. **Verify "Close All" closes transferred Quick Tab**
   - Action: Click "Close All" in Manager
   - Expected: QT 1 closes, Manager shows empty state

---

## Scenario 24: Single Metrics Footer Display (v1.6.4-v3)

**Purpose:** Verify only one metrics footer is displayed (the expandable one in
parent window).

### Steps:

1. **Open Manager sidebar**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager sidebar opens

2. **Count metrics footers**
   - Action: Visually count how many metrics footer rows appear at the bottom
   - Expected: Only ONE metrics footer visible (📑 count, 📊 logs/s, 📈 total)

3. **Verify footer is expandable**
   - Action: Click on the metrics footer row
   - Expected: Category breakdown section expands/collapses showing per-category
     log counts

4. **Switch to Settings tab**
   - Action: Click "Settings" primary tab
   - Expected: Same metrics footer remains visible at bottom

5. **Verify footer updates across tabs**
   - Action: Observe metrics values change over time
   - Expected: Values update regardless of which tab (Settings or Manager) is
     active

---

## Scenario 25: Reduced Logging During Drag Operations (v1.6.4-v3)

**Purpose:** Verify excessive DEBOUNCE logging is eliminated during drag
operations.

### Steps:

1. **Open browser console (F12)**
   - Action: Press F12, go to Console tab
   - Expected: Console visible

2. **Clear console**
   - Action: Click clear/trash icon or run `console.clear()`
   - Expected: Console cleared

3. **Create Quick Tab and drag it**
   - Action: Press Q to create QT 1, then drag it around for 3-5 seconds
   - Expected: Quick Tab moves smoothly

4. **Count debounce logs during drag**
   - Action: Filter console for "DEBOUNCE"
   - Expected: Only see `[DEBOUNCE][DRAG_TRIGGERED]` at start and
     `[DEBOUNCE][DRAG_COMPLETE]` at end (NOT hundreds of
     `[DEBOUNCE][DRAG_EVENT_QUEUED]` logs)

5. **Verify drag complete log shows prevented writes count**
   - Action: Look at `[DEBOUNCE][DRAG_COMPLETE]` log
   - Expected: Shows `preventedWrites: X` where X is the number of events that
     were coalesced

---

## Scenario 26: Container Filter Dropdown (v1.6.4-v4)

**Purpose:** Verify the container filter dropdown filters Quick Tabs by Firefox
Container correctly.

### Steps:

1. **Setup: Create Quick Tabs in different containers**
   - Action: Open WP 1 in Default container, create QT 1; Open WP 2 in Personal
     container, create QT 2; Open WP 3 in Work container, create QT 3
   - Expected: Three Quick Tabs in three different containers

2. **Open Manager and verify default filter**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows container dropdown with "🌐 All Containers"
     selected (v1.6.4-v4 default)
   - Expected: All three Quick Tabs visible (QT 1, QT 2, QT 3)

3. **Change filter to "Current Container"**
   - Action: Click container dropdown, select current container option
   - Expected: Manager shows only Quick Tabs from the current container
   - Expected: Dropdown label updates to show current container name

4. **Filter by specific container**
   - Action: Click dropdown, select "Personal" container
   - Expected: Manager shows only QT 2 (Personal container)

5. **Switch to different container tab while filtering by current**
   - Action: Set filter to "Current Container", switch to WP 2 (Personal
     container tab)
   - Expected: Dropdown label updates to show "💼 Personal" as current container
   - Expected: Quick Tabs list updates to show only Personal container Quick
     Tabs

6. **Verify filter preference persists**
   - Action: Set filter to "Personal" container, close and reopen Manager
   - Expected: Filter still set to "Personal" after reopening

---

## Scenario 27: Container Name Resolution (v1.6.4-v4)

**Purpose:** Verify container names are properly resolved from
contextualIdentities API instead of showing numeric IDs.

### Steps:

1. **Open Manager with Quick Tabs in named containers**
   - Action: Create Quick Tabs in containers named "Shopping", "Research",
     "Work"
   - Expected: Container dropdown shows actual names (Shopping, Research, Work)
     NOT "Firefox Container 1, 2, 3"

2. **Verify container icons display**
   - Action: Check container dropdown options
   - Expected: Each container shows its configured icon (🛒, 📚, 💼 etc.)

3. **Verify console logs show container names**
   - Action: Open browser console, switch containers
   - Expected: Logs show `currentContainerName: "Shopping"` instead of just
     `currentContainerId: "firefox-container-1"`

---

## Scenario 28: Container Filter Properly Includes originContainerId (v1.6.4-v4)

**Purpose:** Verify Quick Tabs include `originContainerId` field so container
filter works correctly.

### Steps:

1. **Open WP 1 in Personal container, create QT 1**
   - Action: Right-click new tab → "Personal" container, navigate to Wikipedia,
     press Q
   - Expected: QT 1 created with `originContainerId: "firefox-container-X"`
     (where X is Personal container ID)

2. **Open Manager and set filter to "Personal" container**
   - Action: Press Ctrl+Alt+Z, click container dropdown, select "Personal"
   - Expected: QT 1 appears in filtered list (container filter matches
     originContainerId)

3. **Open WP 2 in Work container, create QT 2**
   - Action: Right-click new tab → "Work" container, navigate to Wikipedia,
     press Q
   - Expected: QT 2 created with different `originContainerId`

4. **Verify Personal filter excludes Work Quick Tab**
   - Action: With Personal filter still active, observe Manager list
   - Expected: Only QT 1 visible (QT 2 filtered out because originContainerId
     doesn't match)

5. **Verify Quick Tab data in console**
   - Action: Open browser console, check Quick Tab object
   - Expected: `originContainerId` field is present and correctly populated (not
     undefined or 'firefox-default' for container tabs)

---

## Scenario 29: "Default" Container Not in Dropdown (v1.6.4-v4)

**Purpose:** Verify "firefox-default" container does not appear as a separate
dropdown option since "All Containers" already includes it.

### Steps:

1. **Setup: Create Quick Tabs in default and named containers**
   - Action: Open WP 1 in default (no container), create QT 1; Open WP 2 in
     Personal container, create QT 2
   - Expected: Two Quick Tabs created

2. **Open Manager container dropdown**
   - Action: Press Ctrl+Alt+Z, click container filter dropdown
   - Expected: Dropdown shows "🌐 All Containers" and named containers
     (Personal, Work, etc.)

3. **Verify "Default" or "firefox-default" NOT in list**
   - Action: Scan all dropdown options
   - Expected: NO option labeled "Default", "firefox-default", or "No Container"
     appears

4. **Verify default container Quick Tabs visible under "All Containers"**
   - Action: Select "🌐 All Containers" filter
   - Expected: QT 1 (default container) AND QT 2 (Personal) both visible

5. **Verify filtering to named container excludes default**
   - Action: Select "Personal" from dropdown
   - Expected: Only QT 2 visible; QT 1 (default container) NOT shown

---

## Scenario 30: Tab Group Drag-Drop on Full Element (v1.6.4-v4)

**Purpose:** Verify tab groups can be reordered by dragging anywhere on the
group element, not just the header.

### Steps:

1. **Setup: Create Quick Tabs in multiple tabs**
   - Action: Open WP 1, create QT 1; Open YT 1, create QT 2; Open GH 1, create
     QT 3
   - Expected: Three tab groups in Manager (Wikipedia, YouTube, GitHub)

2. **Open Manager**
   - Action: Press Ctrl+Alt+Z
   - Expected: Manager shows three tab groups in default order

3. **Drag tab group by its Quick Tab item area**
   - Action: Drag the Wikipedia group by clicking on the QT 1 item area (NOT the
     group header)
   - Expected: Drag operation initiates for the TAB GROUP (not just the Quick
     Tab item)

4. **Drop tab group onto another group**
   - Action: Drop Wikipedia group onto YouTube group's drop zone
   - Expected: Tab groups reorder successfully (Wikipedia moves to new position)

5. **Verify Quick Tab item drag still works**
   - Action: Drag QT 1 from Wikipedia group to GitHub group (cross-tab transfer)
   - Expected: QT 1 transfers to GitHub group (Quick Tab item-level drag still
     functional)

6. **Verify no console errors during drag operations**
   - Action: Open browser console, perform several drag operations
   - Expected: No errors related to `stopPropagation` or event bubbling

---

## Scenario 31: Auto-Detect Indicator in Current Container Option (v1.6.4-v4)

**Purpose:** Verify the Current Container dropdown option shows "(auto-detect)"
indicator to clarify dynamic behavior.

### Steps:

1. **Open Manager and view container dropdown**
   - Action: Press Ctrl+Alt+Z, click on container filter dropdown
   - Expected: Dropdown opens showing available options

2. **Verify Current Container option shows auto-detect indicator**
   - Action: Locate the "Current Container" option in dropdown
   - Expected: Option text shows "Container Name (auto-detect)" format (e.g.,
     "💼 Work (auto-detect)")
   - Expected: NOT just "Current Container" or plain container name

3. **Verify tooltip mentions auto-detection**
   - Action: Hover over Current Container option
   - Expected: Tooltip explains dynamic behavior (container changes when
     switching tabs)

4. **Verify other container options do NOT have indicator**
   - Action: Check "All Containers" and specific named container options
   - Expected: "All Containers" and static container options do NOT show
     "(auto-detect)"

5. **Verify indicator updates with container context**
   - Action: Switch to tab in Personal container, open dropdown
   - Expected: Current Container option shows "👤 Personal (auto-detect)"

---

## Scenario 32: Quick Tabs List Auto-Updates on Container Switch (v1.6.4-v4)

**Purpose:** Verify Quick Tabs list refreshes automatically when switching
containers while "Current Container" filter is active.

### Steps:

1. **Setup: Create Quick Tabs in different containers**
   - Action: Open WP 1 in Personal container, create QT 1; Open WP 2 in Work
     container, create QT 2
   - Expected: Two Quick Tabs in two different containers

2. **Open Manager and set filter to "Current Container"**
   - Action: Press Ctrl+Alt+Z in Personal container tab, select "Current
     Container" from dropdown
   - Expected: Manager shows only QT 1 (Personal container Quick Tab)

3. **Switch to Work container tab**
   - Action: Click on WP 2 tab (Work container)
   - Expected: Manager automatically refreshes and shows QT 2 (Work container)
   - Expected: QT 1 (Personal) no longer visible in list

4. **Verify no stale data displayed**
   - Action: Rapidly switch between Personal and Work container tabs
   - Expected: Each switch triggers fresh data fetch via
     `requestAllQuickTabsViaPort()`
   - Expected: List always reflects Quick Tabs for current container

5. **Verify container indicator updates in header**
   - Action: Observe dropdown label during container switches
   - Expected: Dropdown label updates to show new container name (e.g., "💼 Work
     (auto-detect)" → "👤 Personal (auto-detect)")

6. **Verify other filters not affected by container switch**
   - Action: Set filter to "All Containers", switch between container tabs
   - Expected: All Quick Tabs remain visible regardless of which tab is active

---

## Scenario 33: Container Indicator Badge in "All Containers" View (v1.6.4-v4)

**Purpose:** Verify container indicator badge displays Firefox Container name
with color for each tab group when "All Containers" filter is selected.

### Steps:

1. **Setup: Create Quick Tabs in different containers**
   - Action: Open WP 1 in Default container, create QT 1; Open WP 2 in Shopping
     container (blue), create QT 2; Open WP 3 in Work container (orange), create
     QT 3
   - Expected: Three Quick Tabs in three different containers

2. **Open Manager with "All Containers" filter**
   - Action: Press Ctrl+Alt+Z, ensure "🌐 All Containers" is selected in
     dropdown
   - Expected: Manager shows all three tab groups (Wikipedia 1, Wikipedia 2,
     Wikipedia 3)

3. **Verify container badge appears on each tab group**
   - Action: Observe tab group headers
   - Expected: Each tab group header shows a colored badge next to the tab title
   - Expected: Badge shows container name (e.g., "Shopping", "Work") NOT numeric
     ID
   - Expected: Badge color matches Firefox container color (blue, orange, etc.)

4. **Verify Default container tabs have no badge**
   - Action: Observe WP 1 tab group (Default container)
   - Expected: No container badge shown for Default container (clean appearance)

5. **Verify badge visibility when switching filters**
   - Action: Change filter from "All Containers" to "Shopping"
   - Expected: Container badge NOT shown when filtering by specific container
     (redundant)
   - Action: Switch back to "All Containers"
   - Expected: Container badges reappear on non-default container tab groups

6. **Verify badge color scheme**
   - Action: Create Quick Tabs in containers with different colors (blue,
     turquoise, green, yellow, orange, red, pink, purple)
   - Expected: Each badge displays correct Firefox container color

---

## Scenario 34: Go to Tab Button Works for Cross-Container Tabs (v1.6.4-v4)

**Purpose:** Verify "Go to Tab" button properly focuses cross-container tabs by
first focusing the window, then activating the tab.

### Steps:

1. **Setup: Create Quick Tab in different container**
   - Action: Open WP 1 in Personal container, create QT 1
   - Expected: QT 1 visible in WP 1

2. **Switch to tab in different container**
   - Action: Open YT 1 in Work container, switch to YT 1
   - Expected: YT 1 is active, WP 1 (Personal) is inactive

3. **Open Manager from YT 1**
   - Action: Press Ctrl+Alt+Z in YT 1
   - Expected: Manager shows QT 1 under "Wikipedia Tab 1" with Personal
     container badge

4. **Click "Go to Tab" button on QT 1's tab group**
   - Action: Find WP 1 tab group header, click "Go to Tab" button (→ icon)
   - Expected: Browser focus switches to WP 1 tab (Personal container)

5. **Verify window.update called before tabs.update**
   - Action: Open browser console, check for focus sequence logs
   - Expected: Logs show `browser.windows.update()` called first (if
     cross-window), then `browser.tabs.update()` to activate tab

6. **Verify cross-window scenario**
   - Action: Open WP 2 in different browser window (same container), create QT 2
   - Action: From original window, click "Go to Tab" on WP 2 group
   - Expected: Focus switches to second browser window, WP 2 tab activated

7. **Verify "Go to Tab" works from Manager in any container context**
   - Action: With Manager open in Work container, click "Go to Tab" on Personal
     container tab group
   - Expected: Browser correctly navigates to Personal container tab without
     errors

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

## Scenario 35: Close All Respects Container Filter (v1.6.4-v4)

**Feature:** The "Close All" button in the Manager respects the current
container filter setting. When viewing a specific container, Close All only
closes Quick Tabs in that container, leaving Quick Tabs in other containers
untouched.

### Setup

1. Open WP 1 in Firefox Container "Shopping" (FX Shopping)
2. Open WP QT 1 and WP QT 2 in WP 1
3. Open WP 2 in Firefox Container "Research" (FX Research)
4. Open WP QT 3 and WP QT 4 in WP 2
5. Open Manager (Ctrl+Alt+Z)
6. Set container filter to "Shopping" container

### Actions

**Action A:** Click "Close All" button in Manager header

### Expected Behavior

**After Action A:**

| Component        | Expected State                            |
| ---------------- | ----------------------------------------- |
| WP QT 1          | ❌ CLOSED (was in Shopping container)     |
| WP QT 2          | ❌ CLOSED (was in Shopping container)     |
| WP QT 3          | ✅ STILL OPEN (in Research container)     |
| WP QT 4          | ✅ STILL OPEN (in Research container)     |
| Manager List     | Shows only WP 2 group with QT 3 and QT 4  |
| Container Filter | Still set to "Shopping" (now shows empty) |

### Implementation Details

**Sidebar (`quick-tabs-manager.js`):**

1. `closeAllTabs()` reads `_getSelectedContainerFilter()`
2. Resolves "current" to actual container ID via `_getCurrentContainerId()`
3. Passes `containerFilter` to `_sendClearAllMessage()`
4. Message includes `containerFilter` field for background processing

**Background (`background.js`):**

1. `handleSidebarCloseAllQuickTabs()` extracts `containerFilter` from message
2. Uses `_filterQuickTabsByContainerForClose()` to get matching Quick Tabs
3. Only notifies content scripts for Quick Tabs in the target container
4. Uses `_removeQuickTabsFromSessionStateByContainer()` to update state
5. Quick Tabs in other containers remain in session state

**Key Messages:**

- `CLOSE_ALL_QUICK_TABS` now includes `containerFilter` field
- `containerFilter: 'all'` closes all Quick Tabs (default)
- `containerFilter: 'firefox-container-X'` closes only that container

---

## Scenario 36: Cross-Container Quick Tab Transfer Updates Container ID (v1.6.4-v4)

**Feature:** When transferring a Quick Tab from a tab in Container 1 to a tab in
Container 2, the Quick Tab's `originContainerId` is updated to match the new
container. This ensures the Quick Tab appears in the correct container's
filtered view after the transfer.

### Setup

1. Open WP 1 in Firefox Container "Shopping" (FX Shopping)
2. Open WP QT 1 in WP 1 (originContainerId = "firefox-container-1" for Shopping)
3. Open WP 2 in Firefox Container "Research" (FX Research)
4. Open Manager (Ctrl+Alt+Z)
5. Set container filter to "All Containers"

### Actions

**Action A:** Drag WP QT 1 from WP 1 group to WP 2 group in Manager

**Action B:** Switch container filter to "Research" container

### Expected Behavior

**After Action A (Transfer):**

| Component         | Expected State                              |
| ----------------- | ------------------------------------------- |
| WP QT 1 location  | Now belongs to WP 2 (originTabId changed)   |
| WP QT 1 container | Now in Research (originContainerId changed) |
| Manager List      | WP QT 1 now appears in WP 2 group           |
| Container Badge   | Shows "Research" for WP QT 1 in All view    |

**After Action B (Filter Change):**

| Component    | Expected State                          |
| ------------ | --------------------------------------- |
| Manager List | Shows WP 2 group with WP QT 1           |
| WP QT 1      | ✅ VISIBLE (now in Research container)  |
| WP 1 group   | Not visible (no Quick Tabs in Research) |

### Implementation Details

**Background (`background.js`):**

1. `handleSidebarTransferQuickTab()` is now async
2. Calls `_getTargetTabContainerId()` to get target tab's container ID
3. `_updateStateForTransfer()` now accepts `newContainerId` parameter
4. Updates `quickTabData.originContainerId` and `quickTabData.cookieStoreId`
5. Updates `globalQuickTabState.tabs[].originContainerId` and `.cookieStoreId`
6. `TRANSFER_QUICK_TAB_ACK` includes `newContainerId` field

**Key Logs:**

- `[Background] TRANSFER_TARGET_TAB_INFO` shows target tab's container
- `[Background] TRANSFER_CONTAINER_UPDATE` logs when container changes
- `[Background] TRANSFER_QUICK_TAB_EXIT` includes `newContainerId`

---

## Scenario 37: Go to Tab Cross-Container Focus Fix (v1.6.4-v4)

**Feature:** When clicking "Go to Tab" button in the Manager sidebar for a tab
in a different Firefox Container, the browser now properly switches focus to
that tab. Previously, the API calls succeeded but the sidebar retained focus,
making it appear like nothing happened. This fix also ensures compatibility with
Zen Browser, which has similar focus retention issues.

### Setup

1. Open WP 1 in Firefox Container "Shopping" (FX Shopping)
2. Open WP QT 1 in WP 1
3. Open WP 2 in Firefox Container "Research" (FX Research)
4. Open WP QT 2 in WP 2
5. Open Manager sidebar (Ctrl+Alt+Z)
6. Set container filter to "All Containers"
7. Have WP 1 (Shopping) as the active tab

### Actions

**Action A:** Click "Go to Tab" button for WP 2 (Research container tab)

### Expected Behavior

**After Action A (Go to Tab):**

| Component    | Expected State                                   |
| ------------ | ------------------------------------------------ |
| Active Tab   | WP 2 is now the active tab (visible)             |
| Tab Switch   | Browser properly switches from WP 1 to WP 2      |
| Main Content | WP 2's content is displayed in main browser area |
| Sidebar      | Closes automatically for reliable focus transfer |
| Container    | Now viewing Research container context           |

### Root Cause Analysis

Firefox WebExtension sidebars have a known limitation where they retain focus
even after `browser.tabs.update()` and `browser.windows.update()` calls succeed.
The API calls work correctly (logs show `GO_TO_TAB_SUCCESS`), but the sidebar
panel keeps input focus, which prevents the user from interacting with the
newly-active tab. Zen Browser exhibits the same behavior as it is built on
Firefox.

**Critical Finding:** `browser.sidebarAction.close()` must be called
synchronously from a user input handler. Previous code did `await` calls first
(tabs.get, tabs.query, windows.update, tabs.update), which broke the user input
chain and caused `sidebarAction.close()` to fail silently.

### Implementation Details

**Manager (`sidebar/quick-tabs-manager.js`):**

1. `_handleGoToTabGroup()` calls `sidebarAction.close()` synchronously FIRST
2. Sidebar closes immediately on click, before any async operations
3. Async tab switching (window focus + tab activate) happens after sidebar close
4. Cross-container logging preserved for debugging Zen Browser compatibility

**Key Logs:**

- `[Manager] GO_TO_TAB_CLICKED` shows click registered with container context
- `[Manager] GO_TO_TAB: Cross-container switch detected` logs container IDs
- `[Manager] GO_TO_TAB_SUCCESS` confirms API calls succeeded
- Browser focus now properly transfers to the selected tab

---

## Scenario 38: Minimize All Quick Tabs in Tab Group (v1.6.4-v4)

**Category:** Quick Tabs Manager - Bulk Actions  
**Feature:** Minimize All button in tab group header  
**Version:** v1.6.4-v4

### Setup

1. Open browser tab WP 1 and create 3 Quick Tabs (WP QT 1, WP QT 2, WP QT 3)
2. All Quick Tabs are visible on screen

### Test Steps

1. Open Quick Tabs Manager (Ctrl+Alt+Z)
2. In the WP 1 tab group header, click the "Minimize All" button (⏬)
3. Observe the Quick Tabs

### Expected Behavior

| Step | Result                                             |
| ---- | -------------------------------------------------- |
| 2    | All 3 Quick Tabs in WP 1 are minimized             |
| 2    | Quick Tabs disappear from screen but stay in state |
| 2    | Manager shows minimized state for all Quick Tabs   |
| 2    | Other tab groups' Quick Tabs remain unchanged      |

### Key Implementation Details

- `_handleMinimizeAllInTabGroup()` function in quick-tabs-manager.js
- Sends `SIDEBAR_MINIMIZE_QUICK_TAB` for each Quick Tab in the group
- Button uses ⏬ icon and appears alongside Close All and Go to Tab buttons

---

## Scenario 39: Shift+Move to Current Tab Duplicates Quick Tab (v1.6.4-v4)

**Category:** Quick Tabs Manager - Quick Tab Actions  
**Feature:** Duplicate on Shift+Move to Current Tab  
**Version:** v1.6.4-v4

### Setup

1. Open browser tab WP 1 and create WP QT 1
2. Open browser tab YT 1 (current active tab)
3. Open Quick Tabs Manager

### Test Steps

1. In Manager, find WP QT 1 listed under WP 1
2. Hold Shift and click "Move to Current Tab" button (➡️ 📋)
3. Observe the results

### Expected Behavior

| Step | Result                                                 |
| ---- | ------------------------------------------------------ |
| 2    | WP QT 1 remains on WP 1 (original not moved)           |
| 2    | A new duplicate Quick Tab appears on YT 1              |
| 2    | Manager shows Quick Tabs on both WP 1 and YT 1         |
| 2    | `DUPLICATE_QUICK_TAB` message sent instead of transfer |

### Key Implementation Details

- `_handleQuickTabActionClick()` captures `shiftKey` from event
- `_dispatchMoveToCurrentTab()` checks for Shift modifier
- `_executeMoveOrDuplicate()` helper for clean conditional dispatch
- Button tooltip shows "(Shift+click to duplicate)"

---

## Scenario 40: Duplicate Quick Tab Updates Container ID (v1.6.4-v4)

**Category:** Quick Tabs Manager - Duplicate  
**Feature:** Duplicated Quick Tabs have correct container ID  
**Version:** v1.6.4-v4

### Setup

1. Open browser tab WP 1 in Firefox Container "Work" (FX 1)
2. Open browser tab YT 1 in Firefox Container "Personal" (FX 2)
3. Create WP QT 1 on WP 1
4. Open Quick Tabs Manager

### Test Steps

1. Set filter to "All Containers" to see all Quick Tabs
2. Shift+Drag WP QT 1 to YT 1 tab group (or Shift+click Move to Current Tab)
3. Set filter to "Personal" container (FX 2)
4. Observe the Quick Tabs list

### Expected Behavior

| Step | Result                                                   |
| ---- | -------------------------------------------------------- |
| 2    | Duplicate Quick Tab created on YT 1                      |
| 2    | Duplicate has `originContainerId: "firefox-container-2"` |
| 3    | Filter shows only the duplicate Quick Tab (on YT 1)      |
| 3    | Original WP QT 1 is filtered out (it's in FX 1)          |

### Key Implementation Details

- `handleSidebarDuplicateQuickTab()` lookups target tab's container ID
- `_createDuplicateQuickTab()` sets `originContainerId` and `cookieStoreId`
- Ensures duplicated Quick Tabs appear in correct container filter view
- Fixes "ghost Quick Tab" bug where duplicates appeared in wrong container

---

## Scenario 41: Right-Click Context Menu for Quick Tab Management (v1.6.4-v4)

**Category:** Quick Tabs Management - Browser Integration  
**Feature:** Right-click context menu for bulk Quick Tab operations  
**Version:** v1.6.4-v4

### Setup

1. Open browser tab WP 1 and create 3 Quick Tabs (WP QT 1, WP QT 2, WP QT 3)
2. All Quick Tabs are visible on screen

### Test Steps

1. Right-click anywhere on the WP 1 page content
2. Observe the browser context menu
3. Click "Close All Quick Tabs on This Tab" menu item
4. Observe the results

### Expected Behavior

| Step | Result                                                          |
| ---- | --------------------------------------------------------------- |
| 2    | Context menu shows "Close All Quick Tabs on This Tab" option    |
| 2    | Context menu shows "Minimize All Quick Tabs on This Tab" option |
| 3    | All 3 Quick Tabs on WP 1 are closed                             |
| 3    | Quick Tabs on other browser tabs remain unaffected              |
| 3    | Manager shows WP 1 group is now empty or removed                |

### Minimize All via Context Menu

1. Open WP 2 and create 2 Quick Tabs (WP QT 4, WP QT 5)
2. Right-click and select "Minimize All Quick Tabs on This Tab"
3. All Quick Tabs minimize (disappear from viewport, shown in Manager)
4. Quick Tabs in WP 1 remain unaffected

### Key Implementation Details

**Background (`background.js`):**

1. `_initializeContextMenus()` called during extension initialization
2. Uses `browser.menus` API (manifest already has "menus" permission)
3. Creates two menu items: "Close All Quick Tabs on This Tab" and "Minimize All
   Quick Tabs on This Tab"
4. Menu items only appear when right-clicking on page content (not links,
   images)
5. Click handlers send close/minimize commands to the current tab only

**Key Logs:**

- `[Background] CONTEXT_MENU: Initializing context menu items`
- `[Background] CONTEXT_MENU: Close all clicked for tabId={id}`
- `[Background] CONTEXT_MENU: Minimize all clicked for tabId={id}`

---

## Scenario 42: Minimized Quick Tab Restore After Cross-Tab Transfer (v1.6.4-v4)

**Category:** Quick Tabs - Cross-Tab Transfer  
**Feature:** Transferred minimized Quick Tabs can be restored correctly  
**Version:** v1.6.4-v4

### Setup

1. Open browser tab WP 1 and create WP QT 1
2. Minimize WP QT 1 (click minimize button or via Manager)
3. Open browser tab YT 1
4. Open Quick Tabs Manager

### Test Steps

1. In Manager, drag WP QT 1 from WP 1 group to YT 1 group (transfer)
2. Observe WP QT 1 now appears under YT 1 group in Manager
3. Click "Restore" button on WP QT 1 in the YT 1 group
4. Observe the results

### Expected Behavior

| Step | Result                                                      |
| ---- | ----------------------------------------------------------- |
| 1    | WP QT 1 transfers from WP 1 to YT 1 successfully            |
| 2    | WP QT 1 listed under YT 1 group with minimized indicator 🟡 |
| 3    | WP QT 1 appears visible in YT 1 viewport                    |
| 3    | WP QT 1 shows active indicator 🟢 in Manager                |
| 3    | No console errors about missing Quick Tab tracking          |

### Root Cause Analysis

When a Quick Tab is transferred between tabs while minimized, the receiving
tab's content script needs the Quick Tab's minimized snapshot (saved position
and size from before minimizing) to restore it correctly. Previously,
transferred Quick Tabs didn't have their snapshot, causing restore to fail with
"Snapshot not found" because the content script couldn't determine where to
position the restored Quick Tab.

### Key Implementation Details

**VisibilityHandler (`src/features/quick-tabs/handlers/VisibilityHandler.js`):**

1. Sends `minimizedSnapshot` (left, top, width, height) with
   `QUICKTAB_MINIMIZED` message
2. Snapshot captured before minimize operation removes DOM element

**Background Script (`background.js`):**

1. Stores snapshots in `quickTabsSessionState.minimizedSnapshots` map
2. `minimizedSnapshots: { [quickTabId]: { left, top, width, height } }`
3. `QUICK_TAB_TRANSFERRED_IN` message includes `minimizedSnapshot` field
4. Logs: `[Background] SNAPSHOT_STORED:`, `[Background] SNAPSHOT_INCLUDED:`

**Content Script (`src/content.js`):**

1. `_handleQuickTabTransferredIn()` extracts `minimizedSnapshot` from message
2. Calls `MinimizedManager.storeTransferredSnapshot()` with snapshot data
3. Logs: `[Content] MINIMIZED_SNAPSHOT_STORED: quickTabId={id}`

**MinimizedManager (`src/features/quick-tabs/minimized-manager.js`):**

1. Added `storeTransferredSnapshot(quickTabId, snapshot)` method
2. Stores snapshot in local map for later restore operation
3. Enables restore to use correct position/size from original tab

---

## Scenario 43: Go to Tab Same-Container Preserves Sidebar (v1.6.4-v5)

**Category:** Quick Tabs Manager - Navigation  
**Feature:** Go to Tab button keeps sidebar open for same-container tabs  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab WP 1 in Firefox Container "Personal" (FX 1)
2. Open WP QT 1 in WP 1
3. Open browser tab YT 1 in the same Firefox Container "Personal" (FX 1)
4. Open YT QT 1 in YT 1
5. Open Quick Tabs Manager (Ctrl+Alt+Z) from WP 1

### Test Steps

1. In Manager, click "Go to Tab" button on the YT 1 tab group header
2. Observe the sidebar and browser tab

### Expected Behavior

| Step | Result                                                          |
| ---- | --------------------------------------------------------------- |
| 1    | Browser switches to YT 1 tab                                    |
| 1    | Sidebar remains OPEN (same container, no focus issue)           |
| 1    | User can continue managing Quick Tabs without reopening sidebar |

### Key Implementation Details

**Manager (`sidebar/quick-tabs-manager.js`):**

1. `_handleGoToTabGroup()` uses `_getGoToTabContainerContext()` helper
2. Helper compares current container ID with target tab container ID
3. If containers match, skips `sidebarAction.close()` call
4. Only cross-container switches trigger sidebar close/reopen
5. Improves user experience for same-container tab navigation

---

## Scenario 44: Go to Tab Cross-Container Reopens Sidebar (v1.6.4-v5)

**Category:** Quick Tabs Manager - Navigation  
**Feature:** Go to Tab closes sidebar, switches tab, then reopens sidebar for
cross-container tabs  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab WP 1 in Firefox Container "Personal" (FX 1)
2. Open WP QT 1 in WP 1
3. Open browser tab YT 1 in Firefox Container "Work" (FX 2)
4. Open Quick Tabs Manager (Ctrl+Alt+Z) from WP 1
5. Set container filter to "All Containers"

### Test Steps

1. In Manager, click "Go to Tab" button on the YT 1 tab group header (different
   container)
2. Wait 300ms after tab switch
3. Observe the sidebar and browser tab

### Expected Behavior

| Step | Result                                                     |
| ---- | ---------------------------------------------------------- |
| 1    | Sidebar closes immediately (synchronously from user input) |
| 1    | Browser switches to YT 1 tab                               |
| 2    | Sidebar reopens automatically after 300ms delay            |
| 2    | User can continue managing Quick Tabs in new container     |

### Root Cause Analysis

Firefox WebExtension sidebars retain focus even after successful `tabs.update()`
calls. For cross-container switches, the sidebar must close first to transfer
focus to the main browser area. After the tab switch completes, the sidebar is
reopened to enable continued Quick Tab management.

### Key Implementation Details

**Manager (`sidebar/quick-tabs-manager.js`):**

1. `_handleGoToTabGroup()` calls `_getGoToTabContainerContext()` to detect
   cross-container switch
2. For cross-container: `_handleGoToTabSidebarClose()` called synchronously
   FIRST
3. `_handleGoToTabSidebarClose()` uses `browser.sidebarAction.close()`
   immediately
4. After async tab switch completes, `setTimeout()` with 300ms delay triggers
   `browser.sidebarAction.open()`
5. This enables "Go to Tab → Continue Managing" workflow across containers

**Key Logs:**

- `[Manager] GO_TO_TAB: Cross-container switch detected, closing sidebar`
- `[Manager] GO_TO_TAB: Same-container switch, keeping sidebar open`
- `[Manager] GO_TO_TAB_SIDEBAR_REOPEN: Reopening sidebar after 300ms`

---

## Scenario 45: Toggle Quick Tabs Manager via Context Menu (v1.6.4-v5)

**Category:** Browser Integration  
**Feature:** Right-click context menu option to toggle sidebar  
**Version:** v1.6.4-v5

### Setup

1. Open any browser tab (e.g., WP 1)
2. Quick Tabs Manager sidebar is initially closed

### Test Steps

**Test A: Open Sidebar via Context Menu**

1. Right-click anywhere on the page content
2. Observe the browser context menu
3. Click "Toggle Quick Tabs Manager" menu item
4. Observe the sidebar

**Test B: Close Sidebar via Context Menu**

1. With sidebar open, right-click on page content
2. Click "Toggle Quick Tabs Manager" menu item
3. Observe the sidebar

### Expected Behavior

**Test A:**

| Step | Result                                                |
| ---- | ----------------------------------------------------- |
| 2    | Context menu shows "Toggle Quick Tabs Manager" option |
| 4    | Quick Tabs Manager sidebar opens                      |
| 4    | Sidebar shows Quick Tabs from all tabs (if any exist) |

**Test B:**

| Step | Result                             |
| ---- | ---------------------------------- |
| 3    | Quick Tabs Manager sidebar closes  |
| 3    | Main browser content regains focus |

### Key Implementation Details

**Background (`background.js`):**

1. `_initializeContextMenus()` adds "Toggle Quick Tabs Manager" menu item
2. Uses `browser.menus` API with `contexts: ["page"]`
3. Click handler calls `browser.sidebarAction.toggle()` API
4. Toggle API opens sidebar if closed, closes if open
5. Menu item ID: `"toggle-quick-tabs-manager"`

**Key Logs:**

- `[Background] CONTEXT_MENU: Toggle Quick Tabs Manager clicked`

---

## Scenario 46: Minimized Quick Tab Restore After Cross-Container Transfer (v1.6.4-v5)

**Category:** Quick Tabs - Cross-Tab Transfer  
**Feature:** Minimized Quick Tabs can be restored after transferring to a tab in
a different container  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab WP 1 in Firefox Container "Personal" (FX 1)
2. Create WP QT 1 in WP 1 and position it at (200, 200)
3. Minimize WP QT 1 (snapshot captured at 200, 200)
4. Open browser tab YT 1 in Firefox Container "Work" (FX 2)
5. Open Quick Tabs Manager

### Test Steps

1. Drag minimized WP QT 1 from WP 1 group to YT 1 group (cross-container
   transfer)
2. Switch to YT 1 browser tab
3. Click "Restore" button on WP QT 1 in Manager

### Expected Behavior

| Step | Result                                                                |
| ---- | --------------------------------------------------------------------- |
| 1    | WP QT 1 transfers to YT 1 (originTabId and originContainerId updated) |
| 1    | minimizedSnapshot transferred along with Quick Tab data               |
| 3    | WP QT 1 appears visible in YT 1 viewport at (200, 200)                |
| 3    | Window reference properly updated from snapshot                       |
| 3    | No "Snapshot not found" errors in console                             |

### Root Cause Analysis

Previously, cross-container transfers of minimized Quick Tabs required a
restore-minimize-restore cycle because the minimized snapshot was not
transferred. Now, `updateTransferredSnapshotWindow()` in MinimizedManager
ensures the snapshot's window reference is updated, allowing first-restore to
work correctly.

### Key Implementation Details

**VisibilityHandler (`src/features/quick-tabs/handlers/VisibilityHandler.js`):**

1. Sends `minimizedSnapshot` with `QUICKTAB_MINIMIZED` message
2. Snapshot includes `left`, `top`, `width`, `height` and `window` reference

**Background (`background.js`):**

1. Stores snapshot in `quickTabsSessionState.minimizedSnapshots[quickTabId]`
2. Includes snapshot in `QUICK_TAB_TRANSFERRED_IN` message
3. Logs: `[Background] SNAPSHOT_INCLUDED: quickTabId={id}`

**Content Script (`src/content.js`):**

1. `_handleQuickTabTransferredIn()` calls
   `MinimizedManager.storeTransferredSnapshot()`
2. Logs: `[Content] MINIMIZED_SNAPSHOT_STORED: quickTabId={id}`

**MinimizedManager (`src/features/quick-tabs/minimized-manager.js`):**

1. `storeTransferredSnapshot(quickTabId, snapshot)` stores incoming snapshot
2. `updateTransferredSnapshotWindow(quickTabId, window)` updates window
   reference
3. Enables restore to use correct position/size from original tab

**Key Logs:**

- `[Background] SNAPSHOT_STORED: quickTabId={id}`
- `[Background] SNAPSHOT_INCLUDED: quickTabId={id} in QUICK_TAB_TRANSFERRED_IN`
- `[Content] MINIMIZED_SNAPSHOT_STORED: quickTabId={id}`
- `[MinimizedManager] SNAPSHOT_WINDOW_UPDATED: quickTabId={id}`

---

## Scenario 47: Minimized Transfer Restore Fix (v1.6.4-v5)

**Category:** Quick Tabs - Cross-Tab Transfer  
**Feature:** Fixed `result?.tabWindow` to `result` since `createQuickTab()`
returns `tabWindow` directly  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab WP 1 and create WP QT 1
2. Move WP QT 1 to position (300, 200)
3. Minimize WP QT 1 (snapshot captured at 300, 200)
4. Open browser tab YT 1

### Test Steps

1. Drag minimized WP QT 1 from WP 1 to YT 1 (cross-tab transfer)
2. Switch to YT 1 browser tab
3. Click "Restore" button on WP QT 1

### Expected Behavior

| Step | Result                                                         |
| ---- | -------------------------------------------------------------- |
| 1    | WP QT 1 transfers to YT 1 successfully                         |
| 3    | WP QT 1 appears at (300, 200) in YT 1 viewport                 |
| 3    | `updateTransferredSnapshotWindow()` called with correct window |
| 3    | No "Cannot read property 'tabWindow' of undefined" errors      |

### Root Cause Analysis

The content.js code was checking `result?.tabWindow` but `createQuickTab()`
returns the `tabWindow` object directly, not an object with a `tabWindow`
property. The fix changed `result?.tabWindow` to just `result`.

### Key Implementation Details

**Content Script (`src/content.js`):**

1. `_handleQuickTabTransferredIn()` receives minimizedSnapshot from background
2. Calls `createQuickTab()` which returns `tabWindow` directly
3. Passes `result` (not `result?.tabWindow`) to
   `updateTransferredSnapshotWindow()`
4. Snapshot window reference is properly updated for restore

**Key Logs:**

- `[Content] TRANSFERRED_SNAPSHOT_WINDOW_UPDATED: quickTabId={id}`

---

## Scenario 48: Go to Tab Error Handling (v1.6.4-v5)

**Category:** Quick Tabs Manager - Navigation  
**Feature:** Added `.catch()` error handler and container-aware routing  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab WP 1 in Firefox Container "Personal"
2. Create WP QT 1 in WP 1
3. Open Quick Tabs Manager

### Test Steps

1. Close WP 1 browser tab (but keep Manager open)
2. Click "Go to Tab" button for the now-closed WP 1 tab group
3. Observe error handling

### Expected Behavior

| Step | Result                                         |
| ---- | ---------------------------------------------- |
| 2    | Error is caught by `.catch()` handler          |
| 2    | No unhandled promise rejection in console      |
| 2    | Error logged with context (tabId, containerId) |
| 2    | UI remains responsive and doesn't freeze       |

### Key Implementation Details

**Manager (`sidebar/quick-tabs-manager.js`):**

1. Go to Tab button click listener has `.catch(err => {...})` handler
2. `_dispatchGoToTab()` delegates to `_handleGoToTabGroup()` for consistency
3. Old `goToTab()` function now calls `_handleGoToTabGroup()` internally
4. All code paths use the same container-aware routing logic

---

## Scenario 49: Clear Log History Confirmation Dialog (v1.6.4-v5)

**Category:** Settings - Log Management  
**Feature:** Confirmation dialog before clearing all logs  
**Version:** v1.6.4-v5

### Setup

1. Open several browser tabs and create Quick Tabs
2. Perform various actions to generate logs
3. Open Quick Tabs Manager → Settings tab

### Test Steps

1. Click "Clear Log History" button
2. Observe the confirmation dialog
3. Click "Cancel" in the dialog
4. Click "Clear Log History" again
5. Click "OK" in the dialog
6. Observe the results

### Expected Behavior

| Step | Result                                                            |
| ---- | ----------------------------------------------------------------- |
| 2    | `confirm()` dialog appears with message about clearing logs       |
| 2    | Message: "Clear all log history? This will clear background logs, |
|      | content script logs, and manager logs. This cannot be undone."    |
| 3    | Logs are NOT cleared (cancel respected)                           |
| 5    | Logs are cleared                                                  |
| 5    | Status message shows actual counts (see Scenario 50)              |

### Key Implementation Details

**Settings (`sidebar/settings.js`):**

1. `_handleClearLogHistory()` calls `confirm()` BEFORE any clearing
2. Returns early if user cancels (clicks Cancel or presses Escape)
3. Only proceeds with clearing if user confirms (clicks OK)

---

## Scenario 50: Clear Log History Accurate Count (v1.6.4-v5)

**Category:** Settings - Log Management  
**Feature:** Status message shows actual log counts  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab WP 1 and create WP QT 1
2. Open browser tab YT 1 and create YT QT 1
3. Perform various actions to generate logs
4. Open Quick Tabs Manager → Settings tab

### Test Steps

1. Click "Clear Log History" button and confirm
2. Observe the status message

### Expected Behavior

| Step | Result                                                       |
| ---- | ------------------------------------------------------------ |
| 2    | Status shows "Cleared X background logs"                     |
| 2    | Status shows "and logs from Y tabs" where Y is the tab count |
| 2    | If no logs existed: "No cached logs were present"            |

### Key Implementation Details

**Settings (`sidebar/settings.js`):**

1. `_buildClearLogStatusMessage()` helper constructs detailed message
2. Counts background logs from `cachedBackgroundLogs` array
3. Counts tabs with logs from `cachedContentScriptLogs` object keys
4. `_clearManagerLogsViaIframe()` clears Manager logs via iframe message

**Example Messages:**

- "Cleared 42 background logs and logs from 3 tabs"
- "Cleared 15 background logs (no content script logs)"
- "Cleared logs from 2 tabs (no background logs)"
- "No cached logs were present"

---

## Scenario 51: Minimized Quick Tab Transfer Restore - Destination Tab ID Fix (v1.6.4-v5)

**Category:** Quick Tabs - Cross-Tab Transfer  
**Feature:** `storeTransferredSnapshot()` uses destination tab ID, not old
origin  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab WP 1 and create WP QT 1
2. Move WP QT 1 to position (400, 300)
3. Minimize WP QT 1 (snapshot captured: origin tab = WP 1)
4. Open browser tab YT 1

### Test Steps

1. Drag minimized WP QT 1 from WP 1 to YT 1 (cross-tab transfer)
2. Switch to YT 1 browser tab
3. Click "Restore" button on WP QT 1 in Manager
4. Observe where QT 1 appears

### Expected Behavior

| Step | Result                                                          |
| ---- | --------------------------------------------------------------- |
| 1    | WP QT 1 transfers to YT 1 (originTabId updated)                 |
| 3    | WP QT 1 appears in YT 1 viewport at (400, 300)                  |
| 3    | Quick Tab stays on YT 1 after restore (does NOT revert to WP 1) |
| 3    | Snapshot's originTabId correctly points to YT 1                 |

### Root Cause Analysis

Previously, `storeTransferredSnapshot()` stored the snapshot with the OLD origin
tab ID. When restoring, the snapshot would reference the original tab (WP 1),
causing the Quick Tab to either fail to restore or revert to the wrong tab.

The fix adds a `newOriginTabId` parameter to `storeTransferredSnapshot()` that
accepts the destination tab ID from the transfer message.

### Key Implementation Details

**MinimizedManager (`src/features/quick-tabs/minimized-manager.js`):**

1. `storeTransferredSnapshot(quickTabId, snapshot, newOriginTabId)` - new
   parameter
2. Updates snapshot's `originTabId` to destination tab before storing
3. Ensures restore operation uses correct tab context

**Content Script (`src/content.js`):**

1. `_handleQuickTabTransferredIn()` passes `newOriginTabId` from transfer
   message
2. Calls `storeTransferredSnapshot(id, snapshot, newOriginTabId)`

**Key Logs:**

- `[Content] SNAPSHOT_STORED_WITH_NEW_TAB_ID: quickTabId={id}, newTabId={newId}`
- `[MinimizedManager] TRANSFERRED_SNAPSHOT_TAB_UPDATED: {id} -> {newId}`

---

## Scenario 52: Log Metrics Footer Persistence Across Sidebar Sessions (v1.6.4-v5)

**Category:** Quick Tabs Manager - Settings  
**Feature:** Log metrics footer count persists across sidebar close/reopen  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab and create several Quick Tabs
2. Perform various actions (create, minimize, restore, close) to generate logs
3. Open Quick Tabs Manager (Ctrl+Alt+Z)
4. Navigate to Settings tab and observe the metrics footer

### Test Steps

1. Note the "📈 total" count in the metrics footer (e.g., "📈 157 total")
2. Close the Quick Tabs Manager sidebar
3. Wait 5 seconds
4. Reopen Quick Tabs Manager (Ctrl+Alt+Z)
5. Observe the "📈 total" count in the metrics footer

### Expected Behavior

| Step | Result                                                     |
| ---- | ---------------------------------------------------------- |
| 1    | Metrics footer shows total log action count (e.g., 157)    |
| 4    | Total count is preserved (still shows 157, not reset to 0) |
| 4    | New log actions increment from persisted value             |

### Root Cause Analysis

Previously, `_totalLogActions` was a module-level variable that reset to 0 each
time the sidebar was opened. This made the "total log actions" metric useless
for tracking session-wide activity.

The fix persists `_totalLogActions` to `browser.storage.local` using a new
storage key with debounced saves to avoid excessive writes.

### Key Implementation Details

**Manager (`sidebar/quick-tabs-manager.js`):**

1. Added `TOTAL_LOG_ACTIONS_KEY = 'quickTabsTotalLogActions'` storage key
2. Loads persisted value on sidebar open via `_loadTotalLogActions()`
3. Saves value on change via `_saveTotalLogActions()` with 2000ms debounce
4. Debounce prevents excessive storage writes during rapid log activity

**Storage Format:**

```javascript
{ 'quickTabsTotalLogActions': 157 }
```

**Key Logs:**

- `[Manager] METRICS_FOOTER_LOADED: totalLogActions={count}`
- `[Manager] METRICS_FOOTER_SAVED: totalLogActions={count}`

---

## Scenario 53: Minimized Quick Tab Transfer Restore Display Fix (v1.6.4-v5)

**Category:** Quick Tabs - Cross-Tab Transfer  
**Feature:** UICoordinator orphan recovery properly updates display CSS after
restore  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab WP 1 and create WP QT 1
2. Position WP QT 1 at (300, 200) and resize to 600x400
3. Minimize WP QT 1 (snapshot captured at 300, 200, 600x400)
4. Open browser tab YT 1

### Test Steps

1. Drag minimized WP QT 1 from WP 1 to YT 1 (cross-tab transfer)
2. Switch to YT 1 browser tab
3. Click "Restore" button on WP QT 1 in Manager
4. Observe the Quick Tab window in YT 1 viewport

### Expected Behavior

| Step | Result                                                             |
| ---- | ------------------------------------------------------------------ |
| 1    | WP QT 1 transfers to YT 1 successfully                             |
| 3    | WP QT 1 appears VISIBLE at (300, 200) with 600x400 size            |
| 3    | Quick Tab window has `display: flex` (NOT `display: none`)         |
| 3    | Quick Tab window has `visibility: visible` and `opacity: 1`        |
| 3    | No invisible/hidden Quick Tab window that requires re-minimization |

### Root Cause Analysis

When a minimized Quick Tab is transferred between tabs and then restored, the
Quick Tab window's DOM container was being created with the CSS properties from
the minimized state (`display: none`). The UICoordinator's orphan window
recovery was re-attaching the window but not updating the display CSS, causing
the restored Quick Tab to be invisible even though the restore operation
succeeded.

### Key Implementation Details

**UICoordinator (`src/features/quick-tabs/coordinators/UICoordinator.js`):**

1. `_updateRecoveredWindowDisplay()` method added for orphan window recovery
2. Sets `container.style.display = 'flex'` after recovery
3. Sets `container.style.visibility = 'visible'` for proper display
4. Sets `container.style.opacity = '1'` for full visibility
5. Called after `_recoverOrphanWindow()` re-attaches the window DOM

**Key Logs:**

- `[UICoordinator] RECOVERED_WINDOW_DISPLAY_UPDATED: quickTabId={id}`
- `[UICoordinator] ORPHAN_WINDOW_RECOVERED: quickTabId={id}`

---

## Scenario 54: Metrics Persistence Flush Before Sidebar Close (v1.6.4-v5)

**Category:** Quick Tabs Manager - Settings  
**Feature:** `beforeunload` handler flushes pending debounced saves immediately  
**Version:** v1.6.4-v5

### Setup

1. Open browser tab and create several Quick Tabs
2. Perform various actions (create, minimize, restore, close) to generate logs
3. Open Quick Tabs Manager (Ctrl+Alt+Z)
4. Navigate to Settings tab and observe the metrics footer

### Test Steps

1. Note the "📈 total" count in the metrics footer (e.g., "📈 42 total")
2. Perform 10 more actions rapidly (e.g., minimize/restore Quick Tabs)
3. Immediately close the sidebar (within 500ms of last action)
4. Wait 1 second
5. Reopen Quick Tabs Manager (Ctrl+Alt+Z)
6. Observe the "📈 total" count

### Expected Behavior

| Step | Result                                                             |
| ---- | ------------------------------------------------------------------ |
| 2    | Metrics footer updates to show ~52 total (42 + 10 new actions)     |
| 3    | `beforeunload` triggers `_saveTotalLogActionsNow()` immediately    |
| 3    | Debounced save is flushed (not lost due to 2000ms debounce delay)  |
| 5    | Total count is preserved at ~52 (all actions saved before close)   |
| 5    | No lost log actions from rapid-close scenario                      |

### Root Cause Analysis

The 2000ms debounce for saving `_totalLogActions` meant that if the sidebar was
closed within 2 seconds of the last log action, the updated count would be lost.
The fix adds a `beforeunload` event handler that calls
`_saveTotalLogActionsNow()` to immediately flush any pending debounced saves
before the sidebar closes.

### Key Implementation Details

**Manager (`sidebar/quick-tabs-manager.js`):**

1. `_saveTotalLogActionsNow()` - Non-debounced immediate save function
2. `_handleBeforeUnload()` - Event handler for `beforeunload` event
3. `window.addEventListener('beforeunload', _handleBeforeUnload)` - Registered
   on sidebar load
4. Flushes pending `_totalLogActions` value to `storage.local` synchronously
5. Prevents data loss when sidebar closes during debounce window

**Key Logs:**

- `[Manager] METRICS_FOOTER_FLUSHED: totalLogActions={count}`
- `[Manager] BEFOREUNLOAD_FLUSH: pending totalLogActions saved`

---

## Scenario 55: Clean URL Copying (v1.6.4-v7)

**Category:** URL Copy - Tracking Parameter Removal  
**Feature:** Copy URL action strips tracking/affiliate parameters by default  
**Version:** v1.6.4-v7

### Setup

1. Open a browser tab with a URL containing tracking parameters
2. Examples:
   - YouTube: `https://youtube.com/watch?v=abc123&si=tracking&feature=share`
   - Amazon: `https://amazon.com/dp/B123?tag=affiliate-20&linkCode=ogi&ref_=abc`
   - Any site with UTM: `https://example.com/page?id=1&utm_source=twitter&utm_medium=social`

### Test Steps

1. Hover over a link with tracking parameters
2. Press `Y` (default Copy URL shortcut)
3. Paste the copied URL
4. Hover over the same link again
5. Press the "Copy Raw URL" shortcut (unbound by default - must be configured)
6. Paste the copied raw URL

### Expected Behavior

| Step | Result                                                                    |
| ---- | ------------------------------------------------------------------------- |
| 2    | URL is cleaned before copying                                             |
| 3    | Pasted URL has tracking params removed (e.g., `?v=abc123` without `&si=`) |
| 3    | Content-relevant params preserved (YouTube `v`, `t`, `list`, `index`)     |
| 3    | Notification shows "✓ URL copied!" (clean URL)                            |
| 5    | Raw URL copied with ALL parameters intact                                 |
| 6    | Pasted URL includes all original tracking parameters                      |

### Key Implementation Details

**URL Cleaner (`src/utils/url-cleaner.js`):**

1. `cleanUrl(urlString)` - Strips 90+ tracking parameters
2. Categories: UTM, Facebook, Google, Amazon, YouTube, Analytics, Social
3. Preserves hash fragments and content-relevant parameters
4. Returns original string unchanged for invalid URLs

**Content Script (`src/content.js`):**

1. `handleCopyURL()` - Uses `cleanUrl()` before copying
2. `handleCopyRawURL()` - Copies URL without cleaning (new shortcut)
3. `copyRawUrl` shortcut entry in `SHORTCUT_HANDLERS` table

**Config (`src/core/config.js`):**

1. `copyRawUrlKey: ''` - Unbound by default
2. `copyRawUrlCtrl`, `copyRawUrlAlt`, `copyRawUrlShift` - Modifier keys

---

## Scenario 56: Dark Mode First UI (v1.6.4-v7)

**Category:** UI/UX - Visual Design  
**Feature:** Complete UI overhaul with dark-mode-first design  
**Version:** v1.6.4-v7

### Setup

1. Install extension v1.6.4-v7
2. Open Quick Tabs Manager (Ctrl+Alt+Z)
3. Navigate between Settings and Manager tabs

### Test Steps

1. Observe the sidebar theme
2. Check that accent color is purple-blue (#6c5ce7)
3. Create a Quick Tab and observe in-page styling
4. Switch system to light mode (if supported)
5. Observe the sidebar adapts to light theme

### Expected Behavior

| Step | Result                                                        |
| ---- | ------------------------------------------------------------- |
| 1    | Dark theme is default (#121212 background)                    |
| 2    | Accent color is purple-blue, not green                        |
| 3    | Quick Tab window has dark title bar with glass-morphism       |
| 4    | Light mode override via `prefers-color-scheme: light`         |
| 5    | All UI components adapt to light theme consistently           |

### Key Implementation Details

**CSS Files Rewritten:**

1. `sidebar/settings.css` - Dark-mode-first with CSS variables
2. `sidebar/quick-tabs-manager.css` - Matching design system
3. `src/ui/css/quick-tabs.css` - Glass-morphism effects
4. `sidebar/settings.html` - Inline styles updated

**Design System:**

- Primary background: #121212
- Surface: #1e1e1e
- Elevated: #2a2a2a
- Accent: #6c5ce7 (purple-blue)
- Success: #00b894
- Danger: #e17055
- Warning: #fdcb6e

---

## Scenario 57: Performance Optimization (v1.6.4-v7)

**Category:** Performance - Logging and State  
**Feature:** Reduced logging overhead and state broadcast deduplication  
**Version:** v1.6.4-v7

### Setup

1. Install extension v1.6.4-v7
2. Open browser developer tools Console
3. Create several Quick Tabs

### Test Steps

1. With debug mode OFF, perform Quick Tab operations
2. Observe console output - should be minimal
3. Enable debug mode in settings
4. Perform same operations
5. Observe console output - should be verbose

### Expected Behavior

| Step | Result                                                           |
| ---- | ---------------------------------------------------------------- |
| 1    | Operations work normally                                         |
| 2    | Console shows only warnings/errors (not verbose logs)            |
| 3    | Debug mode enables verbose logging                               |
| 5    | Full diagnostic logging available when needed                    |

### Key Implementation Details

**Logging Reduction (-28.8%):**

1. Verbose `console.log` calls wrapped behind `CONFIG.debugMode` checks
2. `console.warn` and `console.error` always logged (critical diagnostics)
3. Debug mode still provides full verbose output when enabled

**State Broadcast Deduplication:**

1. Hash-based change detection before broadcasting
2. Eliminates redundant STATE_CHANGED messages
3. Reduces unnecessary JSON processing

**Render Debouncing:**

1. 16ms debounce window for rapid render requests
2. Combined with existing requestAnimationFrame and hash checks

---

**End of Scenarios Document**

**Document Maintainer:** ChunkyNosher  
**Repository:** https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Last Review Date:** February 21, 2026  
**Behavior Model:** Tab-Scoped (v1.6.4-v7)
