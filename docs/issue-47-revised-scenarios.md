# Quick Tabs – Comprehensive Behavior Scenarios (v1.6.0+)

**Document Version:** 2.0  
**Last Updated:** November 22, 2025  
**Extension Version:** v1.6.0.11+

---

## Abbreviation Guide

| Code | Meaning               | Example Usage                    |
|------|-----------------------|----------------------------------|
| WP   | Wikipedia             | WP 1 (Wikipedia Tab 1)          |
| YT   | YouTube               | YT 1 (YouTube Tab 1)            |
| GH   | GitHub                | GH 1 (GitHub Tab 1)             |
| TW   | Twitter/X             | TW 1 (Twitter Tab 1)            |
| AM   | Amazon                | AM 1 (Amazon Tab 1)             |
| QT   | Quick Tab             | WP QT 1 (Quick Tab 1)           |
| PM   | Quick Tabs Manager    | PM (Manager Panel)              |
| FX   | Firefox Container     | FX 1 (Container 1)              |

---

## Notation Guide

**Tab Notation:**
- **"WP 1"** = Wikipedia browser tab number 1 (a regular browser tab, NOT a Quick Tab)
- **"YT 2"** = YouTube browser tab number 2

**Quick Tab Notation:**
- **"WP QT 1"** = Quick Tab number 1 (the URL content inside may be any site; "WP" here is just the label/ID)
- **"QT 2"** = Quick Tab number 2 (generic, content unspecified)
- The URL inside a Quick Tab is usually not material unless specifically stated

**Action Notation:**
- **"Open WP QT 1 in WP 1"** = While viewing Wikipedia Tab 1, create Quick Tab 1 (content may vary)
- **"Open YT 1"** = Open a new browser tab, navigate to YouTube (this is the FIRST YouTube tab opened, so it's YT 1, NOT YT 2)
- **"Switch to GH 1"** = Change focus to GitHub Tab 1
- **"Solo QT 1"** = Set Quick Tab 1 to Solo mode (visible only on specific tab)
- **"Mute QT 2"** = Set Quick Tab 2 to Mute mode (hidden only on specific tab)

**Important Clarifications:**
- If you open WP 1, then open YT (a new tab), that YouTube tab is **YT 1**, NOT YT 2
- Tab numbering is per-domain and sequential: first WP tab = WP 1, second WP tab = WP 2, first YT tab = YT 1, etc.
- Quick Tab numbering is sequential across all QTs regardless of content: first QT opened = QT 1, second = QT 2, etc.

**Symbols:**
- **⇨** = Action leads to expected result
- **Solo (🎯)** = Quick Tab only appears on specific browser tab(s)
- **Mute (🔇)** = Quick Tab is hidden only on specific browser tab(s)
- **Global (🌐)** = Quick Tab appears across all browser tabs

---

## Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync

**Purpose:** Verify that Quick Tabs are created correctly, persist across different browser tabs, and maintain consistent position/size state globally.

### Steps:

1. **Open WP 1**
   - Action: Launch browser, navigate to Wikipedia Main Page
   - Expected: WP 1 loads successfully

2. **Open WP QT 1 in WP 1**
   - Action: While viewing WP 1, press Q (or use keyboard shortcut) to create Quick Tab
   - Expected: WP QT 1 appears as floating window in WP 1 with default position (configurable in settings)
   - Note: Quick Tab content URL doesn't matter for this test

3. **Verify QT 1 appears in WP 1**
   - Action: Observe Quick Tab state
   - Expected: QT 1 is visible, draggable, resizable, with toolbar showing all controls (back, forward, reload, solo, mute, minimize, close)

4. **Switch to YT 1** (open new tab)
   - Action: Open new browser tab, navigate to YouTube
   - Expected: YT 1 loads successfully
   - Important: This is YT 1 (first YouTube tab), not YT 2

5. **Verify QT 1 appears in YT 1 at same position/size**
   - Action: Observe Quick Tab state in YT 1
   - Expected: WP QT 1 automatically appears in YT 1 at exact same position and size as in WP 1
   - Cross-tab sync latency: <100ms via BroadcastChannel

6. **Move/resize QT 1 in YT 1**
   - Action: Drag QT 1 to bottom-right corner, resize to 500px × 400px
   - Expected: QT 1 moves/resizes smoothly, position/size saved to storage

7. **Switch back to WP 1**
   - Action: Click on WP 1 tab to bring it to focus
   - Expected: QT 1 now appears at bottom-right corner with 500px × 400px size (synchronized from YT 1)
   - Position/size persistence confirmed across tabs

---

## Scenario 2: Multiple Quick Tabs with Cross-Tab Sync

**Purpose:** Verify that multiple Quick Tabs can coexist, each maintains independent state, and all sync correctly across tabs.

### Steps:

1. **Open WP 1**
   - Action: Navigate to Wikipedia Main Page
   - Expected: WP 1 loads successfully

2. **Open WP QT 1 in WP 1**
   - Action: Press Q to create first Quick Tab
   - Expected: QT 1 appears in WP 1 at default position
   - Note: Slot number "1" visible in debug mode

3. **Open YT 1** (new tab)
   - Action: Open new browser tab, navigate to YouTube
   - Expected: YT 1 loads, QT 1 automatically appears (global sync)

4. **Open YT QT 2 in YT 1**
   - Action: While viewing YT 1, press Q to create second Quick Tab
   - Expected: QT 2 appears in YT 1 at default position (offset from QT 1)
   - Note: Slot number "2" visible in debug mode

5. **Verify both QTs in YT 1**
   - Action: Observe Quick Tab state
   - Expected: Both QT 1 and QT 2 are visible in YT 1, each with independent position/size

6. **Switch to WP 1**
   - Action: Click WP 1 tab
   - Expected: Both QT 1 and QT 2 now appear in WP 1 (QT 2 synced from YT 1)

7. **Move QT 1 to top-left, QT 2 to bottom-right in WP 1**
   - Action: Drag QT 1 to (20px, 20px), drag QT 2 to (calc(100vw - 520px), calc(100vh - 420px))
   - Expected: Both QTs move to specified positions

8. **Switch to YT 1**
   - Action: Click YT 1 tab
   - Expected: QT 1 at top-left, QT 2 at bottom-right (positions synced)
   - Independent state confirmed for each Quick Tab

---

## Scenario 3: Solo Mode (Pin to Specific Tab)

**Purpose:** Verify Solo mode functionality where a Quick Tab appears only on designated browser tab(s), not globally.

### Steps:

1. **Open WP 1**
   - Action: Navigate to Wikipedia
   - Expected: WP 1 loads successfully

2. **Open WP QT 1 in WP 1**
   - Action: Press Q to create Quick Tab
   - Expected: QT 1 appears in WP 1 (global mode by default, 🌐 indicator)

3. **Solo QT 1 (pin to WP 1)**
   - Action: Click Solo button (🎯) in QT 1 toolbar
   - Expected: Solo button state changes to active (highlighted), indicator changes to 🎯
   - Broadcast message sent to all tabs: "QT 1 is now solo on WP 1"

4. **Verify QT 1 visible only in WP 1**
   - Action: Observe QT 1 state
   - Expected: QT 1 remains visible in WP 1

5. **Switch to YT 1** (new tab)
   - Action: Open new tab, navigate to YouTube
   - Expected: YT 1 loads, QT 1 does NOT appear (solo mode active)

6. **Switch to GH 1** (new tab)
   - Action: Open new tab, navigate to GitHub
   - Expected: GH 1 loads, QT 1 does NOT appear

7. **Switch back to WP 1**
   - Action: Click WP 1 tab
   - Expected: QT 1 reappears (solo mode restricts visibility to WP 1 only)

8. **Unsolo QT 1**
   - Action: Click Solo button again (🎯 → ⭕)
   - Expected: Solo deactivated, QT 1 becomes global again

9. **Verify QT 1 now global**
   - Action: Switch to YT 1
   - Expected: QT 1 now appears in YT 1 (global sync restored)

---

## Scenario 4: Mute Mode (Hide on Specific Tab)

**Purpose:** Verify Mute mode functionality where a Quick Tab is hidden only on designated browser tab(s) but visible everywhere else.

### Steps:

1. **Open WP 1**
   - Action: Navigate to Wikipedia
   - Expected: WP 1 loads successfully

2. **Open WP QT 1 in WP 1**
   - Action: Press Q to create Quick Tab
   - Expected: QT 1 appears in WP 1 (global mode, visible everywhere)

3. **Open GH 1** (new tab)
   - Action: Open new tab, navigate to GitHub
   - Expected: GH 1 loads, QT 1 appears (global sync)

4. **Open GH QT 2 in GH 1**
   - Action: Press Q to create second Quick Tab
   - Expected: QT 2 appears in GH 1

5. **Mute QT 1 on YT 1** (open new tab first)
   - Action: Open YT 1, click Mute button (🔇) in QT 1 toolbar
   - Expected: Mute button activates, QT 1 immediately disappears from YT 1
   - Broadcast message sent: "QT 1 muted on YT 1"

6. **Verify QT 1 hidden only in YT 1**
   - Action: Observe QT 1 state in YT 1
   - Expected: QT 1 not visible in YT 1, but QT 2 remains visible

7. **Switch to WP 1**
   - Action: Click WP 1 tab
   - Expected: QT 1 IS visible in WP 1 (mute only affects YT 1)

8. **Switch to GH 1**
   - Action: Click GH 1 tab
   - Expected: Both QT 1 and QT 2 are visible (mute doesn't affect GH 1)

9. **Switch back to YT 1, unmute QT 1**
   - Action: Open Manager Panel (Ctrl+Alt+Z), find QT 1, click unmute
   - Expected: QT 1 reappears in YT 1 (mute removed)

---

## Scenario 5: Manager Panel - Minimize/Restore Quick Tabs

**Purpose:** Verify Quick Tabs Manager Panel opens correctly, displays all Quick Tabs grouped by container, and can minimize/restore tabs.

### Steps:

1. **Open WP 1**
   - Action: Navigate to Wikipedia
   - Expected: WP 1 loads successfully

2. **Open WP QT 1 in WP 1**
   - Action: Press Q to create Quick Tab
   - Expected: QT 1 appears in WP 1

3. **Press Ctrl+Alt+Z to open PM**
   - Action: Press keyboard shortcut for Manager Panel
   - Expected: PM appears as draggable floating panel (default position: top-right, 350px × 500px)
   - Panel shows "Default Container" section with QT 1 listed (green 🟢 active indicator)

4. **Minimize QT 1 via Manager**
   - Action: Click minimize button (➖) next to QT 1 in Manager Panel
   - Expected: QT 1 window minimizes (disappears from viewport), indicator changes to yellow 🟡
   - QT 1 remains in Manager list with "Restore" button visible

5. **Verify minimized state persists across tabs**
   - Action: Open YT 1 (new tab)
   - Expected: QT 1 does not appear in viewport (minimized state synced)

6. **Open Manager in YT 1**
   - Action: Press Ctrl+Alt+Z in YT 1
   - Expected: PM appears, shows QT 1 with yellow 🟡 minimized indicator

7. **Restore QT 1 from Manager in YT 1**
   - Action: Click restore button (↑) next to QT 1 in Manager
   - Expected: QT 1 window reappears at last known position in YT 1, indicator changes to green 🟢

8. **Switch to WP 1**
   - Action: Click WP 1 tab
   - Expected: QT 1 is now visible in WP 1 (restored state synced)

---

## Scenario 6: Cross-Tab Manager Sync

**Purpose:** Verify Manager Panel state syncs across all browser tabs and operations in one tab affect all tabs.

### Steps:

1. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 appears in WP 1

2. **Minimize QT 1 via toolbar minimize button**
   - Action: Click minimize button (−) in QT 1 toolbar
   - Expected: QT 1 minimizes to Manager Panel

3. **Switch to YT 1** (new tab)
   - Action: Open new tab, navigate to YouTube
   - Expected: YT 1 loads, QT 1 NOT visible in viewport (minimized)

4. **Open Manager in YT 1**
   - Action: Press Ctrl+Alt+Z
   - Expected: PM appears showing QT 1 with yellow 🟡 minimized indicator

5. **Open GH 1** (new tab)
   - Action: Open new tab, navigate to GitHub
   - Expected: GH 1 loads

6. **Open Manager in GH 1, restore QT 1**
   - Action: Press Ctrl+Alt+Z, click restore (↑) for QT 1
   - Expected: QT 1 reappears in GH 1

7. **Switch to WP 1**
   - Action: Click WP 1 tab
   - Expected: QT 1 visible in WP 1 (restored state synced)

8. **Switch to YT 1**
   - Action: Click YT 1 tab
   - Expected: QT 1 visible in YT 1 (cross-tab sync confirmed)

---

## Scenario 7: Position/Size Persistence Across Tabs

**Purpose:** Verify that moving and resizing Quick Tabs in one tab correctly syncs position/size to all other tabs.

### Steps:

1. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 appears at default position (e.g., 100px, 100px, 800px × 600px)

2. **Move QT 1 to top-left corner (20px, 20px)**
   - Action: Drag QT 1 title bar to top-left
   - Expected: QT 1 moves to (20px, 20px)
   - BroadcastChannel message sent with new position

3. **Resize QT 1 to 600px × 400px**
   - Action: Drag bottom-right corner resize handle
   - Expected: QT 1 resizes to 600px × 400px
   - Storage updated with new size

4. **Switch to GH 1** (new tab)
   - Action: Open new tab, navigate to GitHub
   - Expected: QT 1 appears in GH 1 at (20px, 20px) with 600px × 400px size

5. **Move QT 1 to bottom-right corner in GH 1**
   - Action: Drag QT 1 to (calc(100vw - 620px), calc(100vh - 420px))
   - Expected: QT 1 moves to bottom-right

6. **Resize QT 1 to 700px × 500px in GH 1**
   - Action: Drag resize handles
   - Expected: QT 1 resizes to 700px × 500px

7. **Switch back to WP 1**
   - Action: Click WP 1 tab
   - Expected: QT 1 now at bottom-right with 700px × 500px (synced from GH 1)

8. **Reload WP 1 (hard refresh)**
   - Action: Press Ctrl+Shift+R
   - Expected: After page reload, QT 1 reappears at bottom-right with 700px × 500px (persistence confirmed)

---

## Scenario 8: Container-Aware Grouping & Isolation

**Purpose:** Verify that Quick Tabs respect Firefox Container boundaries and are properly isolated/grouped by container in Manager Panel.

### Steps:

1. **Open WP 1 in FX 1 (default container)**
   - Action: Open Wikipedia in default Firefox container
   - Expected: WP 1 loads in default container

2. **Open WP QT 1 in FX 1**
   - Action: Press Q to create Quick Tab
   - Expected: QT 1 created in default container context

3. **Open WP 2 in FX 2 (Personal container)**
   - Action: Right-click new tab button → "Personal" container, navigate to Wikipedia
   - Expected: WP 2 loads in Personal container (different from FX 1)

4. **Open WP QT 2 in FX 2**
   - Action: Press Q in WP 2
   - Expected: QT 2 created in Personal container context

5. **Open Manager Panel (PM) in FX 1**
   - Action: Press Ctrl+Alt+Z in WP 1
   - Expected: PM shows two sections:
     - "Default Container" with QT 1
     - "Personal Container" with QT 2

6. **Verify QT 1 only visible in FX 1 tabs**
   - Action: Switch to WP 2 (FX 2 context)
   - Expected: QT 1 does NOT appear (container isolation enforced)

7. **Verify QT 2 only visible in FX 2 tabs**
   - Action: Switch to WP 1 (FX 1 context)
   - Expected: QT 2 does NOT appear (container boundary respected)

8. **Open Manager in FX 2**
   - Action: Press Ctrl+Alt+Z in WP 2
   - Expected: PM shows same two sections, QT 1 in "Default Container", QT 2 in "Personal Container"
   - Manager state syncs across containers but QTs respect boundaries

---

## Scenario 9: Close All Quick Tabs via Manager

**Purpose:** Verify "Close All" button in Manager Panel closes all Quick Tabs across all containers and tabs.

### Steps:

1. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 created

2. **Open YT 1, open YT QT 2**
   - Action: Open YouTube tab, press Q
   - Expected: QT 2 created (both QT 1 and QT 2 visible in YT 1)

3. **Open GH 1, open GH QT 3**
   - Action: Open GitHub tab, press Q
   - Expected: QT 3 created (all 3 QTs visible)

4. **Open Manager Panel in GH 1**
   - Action: Press Ctrl+Alt+Z
   - Expected: PM appears showing all 3 QTs (QT 1, QT 2, QT 3)

5. **Click "Close All" button in Manager**
   - Action: Click "Close All" button at top of Manager Panel
   - Expected: All QTs immediately close, Manager Panel shows "No Quick Tabs" message

6. **Verify all QTs closed in GH 1**
   - Action: Observe viewport
   - Expected: No Quick Tabs visible in GH 1

7. **Switch to YT 1**
   - Action: Click YT 1 tab
   - Expected: No Quick Tabs visible (all closed via cross-tab sync)

8. **Switch to WP 1**
   - Action: Click WP 1 tab
   - Expected: No Quick Tabs visible (close all synced globally)

---

## Scenario 10: Quick Tab Limit Enforcement

**Purpose:** Verify that the maximum Quick Tab limit (configured in settings) is properly enforced with user-friendly notification.

### Steps:

1. **Set max Quick Tabs to 2 in settings**
   - Action: Open extension popup → Quick Tabs tab → Set "Max windows" to 2 → Save
   - Expected: Setting saved successfully

2. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 created successfully (1/2 limit)

3. **Open YT 1, open YT QT 2**
   - Action: Navigate to YouTube, press Q
   - Expected: QT 2 created successfully (2/2 limit reached)

4. **Try to open GH QT 3 in GH 1** (new tab)
   - Action: Navigate to GitHub, press Q
   - Expected: Notification appears: "Maximum Quick Tabs limit reached (2/2)"
   - QT 3 NOT created

5. **Verify only 2 QTs exist**
   - Action: Open Manager Panel
   - Expected: PM shows exactly 2 QTs (QT 1, QT 2)

6. **Close QT 1**
   - Action: Click close button (✕) on QT 1
   - Expected: QT 1 closes, slot freed (1/2 now)

7. **Try to open GH QT 3 again**
   - Action: Press Q in GH 1
   - Expected: QT 3 created successfully (2/2 limit)

8. **Verify limit still enforced**
   - Action: Try to open 4th Quick Tab
   - Expected: Notification: "Maximum Quick Tabs limit reached (2/2)"

---

## Scenario 11: Emergency Position/Size Save on Tab Switch

**Purpose:** Verify that Quick Tab position/size is saved even during rapid tab switching (emergency save mechanism).

### Steps:

1. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 appears at default position

2. **Move QT 1 to center (500px, 300px)**
   - Action: Drag QT 1 to center of viewport
   - Expected: QT 1 positioned at (500px, 300px)

3. **Rapidly switch to YT 1 (within 100ms)**
   - Action: While drag is still settling, immediately open new tab (YouTube)
   - Expected: Emergency save triggered via visibilitychange event
   - Position saved before tab switch completes

4. **Switch back to WP 1**
   - Action: Click WP 1 tab
   - Expected: QT 1 at (500px, 300px) - position preserved

5. **Resize QT 1 to 900px × 700px in WP 1**
   - Action: Drag bottom-right resize handle
   - Expected: QT 1 resizes to 900px × 700px

6. **Rapidly switch to GH 1** (new tab, fast switch)
   - Action: Open GitHub tab immediately during resize
   - Expected: Emergency save triggers, size saved

7. **Verify QT 1 in GH 1**
   - Action: Observe QT 1 state
   - Expected: QT 1 at (500px, 300px) with 900px × 700px size (no data loss)

8. **Switch back to WP 1**
   - Action: Click WP 1 tab
   - Expected: QT 1 maintains 900px × 700px size (emergency save confirmed)

---

## Scenario 12: Close Minimized Quick Tabs Only

**Purpose:** Verify "Close Minimized" button in Manager Panel closes only minimized Quick Tabs while preserving visible ones.

### Steps:

1. **Open WP 1, open WP QT 1 & QT 2**
   - Action: Press Q twice to create QT 1 and QT 2
   - Expected: Both QTs visible in WP 1

2. **Minimize QT 1 via toolbar**
   - Action: Click minimize button (−) on QT 1
   - Expected: QT 1 minimized (yellow 🟡 in Manager)

3. **Keep QT 2 visible (not minimized)**
   - Action: Leave QT 2 as-is
   - Expected: QT 2 remains visible (green 🟢 in Manager)

4. **Open GH 1, open GH QT 3**
   - Action: Navigate to GitHub, press Q
   - Expected: QT 3 created (visible)

5. **Minimize QT 3 in GH 1**
   - Action: Click minimize button on QT 3
   - Expected: QT 3 minimized

6. **Open Manager Panel**
   - Action: Press Ctrl+Alt+Z
   - Expected: PM shows:
     - QT 1 (minimized 🟡)
     - QT 2 (active 🟢)
     - QT 3 (minimized 🟡)

7. **Click "Close Minimized" button**
   - Action: Click "Close Minimized" in Manager Panel
   - Expected: QT 1 and QT 3 close immediately, QT 2 remains open

8. **Verify only QT 2 remains**
   - Action: Switch to WP 1
   - Expected: Only QT 2 visible (QT 1 and QT 3 closed)

---

## Scenario 13: Solo/Mute Mutual Exclusion

**Purpose:** Verify that Solo and Mute modes are mutually exclusive - enabling one disables the other.

### Steps:

1. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 created in global mode

2. **Solo QT 1 (pin to WP 1)**
   - Action: Click Solo button (🎯) on QT 1 toolbar
   - Expected: Solo activated, Mute button disabled (grayed out)

3. **Attempt to click Mute while Solo active**
   - Action: Click Mute button (should be disabled)
   - Expected: No action (button disabled, Solo takes precedence)

4. **Unsolo QT 1**
   - Action: Click Solo button again (🎯 → ⭕)
   - Expected: Solo deactivated, Mute button enabled

5. **Mute QT 1 on YT 1** (open new tab)
   - Action: Open YT 1, click Mute button (🔇) on QT 1
   - Expected: Mute activated, Solo button disabled

6. **Attempt to click Solo while Mute active**
   - Action: Click Solo button (should be disabled)
   - Expected: No action (button disabled, Mute takes precedence)

7. **Unmute QT 1**
   - Action: Click Mute button again (🔇 → 🔊)
   - Expected: Mute deactivated, Solo button enabled

8. **Verify mutual exclusion enforced**
   - Action: Toggle Solo and Mute rapidly
   - Expected: Only one mode active at a time, other button always disabled

---

## Scenario 14: State Persistence Across Browser Restart

**Purpose:** Verify that Quick Tab state (position, size, solo/mute status, minimized state) persists after browser is closed and reopened.

### Steps:

1. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 created

2. **Configure QT 1: Solo to WP 1, position (100px, 200px), size 650px × 450px**
   - Action: Click Solo, drag to (100px, 200px), resize to 650px × 450px
   - Expected: All settings applied, saved to browser.storage.sync

3. **Open YT 1, open YT QT 2**
   - Action: Navigate to YouTube, press Q
   - Expected: QT 2 created

4. **Minimize QT 2**
   - Action: Click minimize button on QT 2
   - Expected: QT 2 minimized

5. **Close browser completely**
   - Action: File → Quit (or Alt+F4)
   - Expected: Browser closes, all state saved to storage

6. **Reopen browser, navigate to WP 1**
   - Action: Launch browser, go to Wikipedia
   - Expected: QT 1 automatically restored at (100px, 200px) with 650px × 450px size
   - Solo mode active (only visible in WP 1)

7. **Open YT 1**
   - Action: Navigate to YouTube
   - Expected: QT 1 does NOT appear (solo mode persisted)
   - QT 2 NOT visible (minimized state persisted)

8. **Open Manager Panel**
   - Action: Press Ctrl+Alt+Z
   - Expected: PM shows QT 1 (solo WP 1) and QT 2 (minimized 🟡)
   - All state persisted correctly across browser restart

---

## Scenario 15: Manager Panel Position/Size Persistence

**Purpose:** Verify that Manager Panel's own position and size persist across browser sessions and tab switches.

### Steps:

1. **Open WP 1, open Manager Panel**
   - Action: Navigate to Wikipedia, press Ctrl+Alt+Z
   - Expected: PM appears at default position (top-right, 350px × 500px)

2. **Move Manager to bottom-left (20px, calc(100vh - 520px))**
   - Action: Drag PM header bar to bottom-left
   - Expected: PM moves to bottom-left corner

3. **Resize Manager to 450px × 600px**
   - Action: Drag PM resize handles
   - Expected: PM resizes to 450px × 600px

4. **Close Manager Panel**
   - Action: Click close button (✕) on PM
   - Expected: PM closes, position/size saved to browser.storage.local

5. **Switch to YT 1** (new tab)
   - Action: Open YouTube tab
   - Expected: YT 1 loads

6. **Open Manager Panel in YT 1**
   - Action: Press Ctrl+Alt+Z
   - Expected: PM appears at bottom-left with 450px × 600px size (position/size synced)

7. **Close browser, reopen**
   - Action: Quit browser, relaunch
   - Expected: Browser restarts

8. **Navigate to GH 1, open Manager**
   - Action: Go to GitHub, press Ctrl+Alt+Z
   - Expected: PM appears at bottom-left with 450px × 600px (persisted across restart)

---

## Scenario 16: Slot Numbering in Debug Mode

**Purpose:** Verify that debug mode slot numbering works correctly, reuses freed slots, and displays accurate labels.

### Steps:

1. **Enable debug mode in settings**
   - Action: Open extension popup → Advanced tab → Check "Enable debug mode" → Save
   - Expected: Debug mode enabled

2. **Open WP 1, open WP QT 1**
   - Action: Navigate to Wikipedia, press Q
   - Expected: QT 1 created with "Slot 1" label visible in toolbar

3. **Open YT 1, open YT QT 2**
   - Action: Navigate to YouTube, press Q
   - Expected: QT 2 created with "Slot 2" label

4. **Open GH 1, open GH QT 3**
   - Action: Navigate to GitHub, press Q
   - Expected: QT 3 created with "Slot 3" label

5. **Close QT 2 (middle slot)**
   - Action: Click close button (✕) on QT 2
   - Expected: QT 2 closes, Slot 2 freed, added to availableSlots array

6. **Open AM 1, open AM QT 4** (new tab)
   - Action: Navigate to Amazon, press Q
   - Expected: QT 4 created with "Slot 2" label (reused freed slot)

7. **Verify slot numbering: Slots 1, 2, 3 occupied**
   - Action: Check all QT labels
   - Expected: QT 1 (Slot 1), QT 4 (Slot 2), QT 3 (Slot 3)

8. **Close all Quick Tabs**
   - Action: Press Esc or click "Close All" in Manager
   - Expected: All QTs close, slot numbering resets

9. **Open new Quick Tab**
   - Action: Press Q
   - Expected: New QT has "Slot 1" label (numbering reset confirmed)

---

## Scenario 17: Multi-Direction Resize Operations

**Purpose:** Verify that Quick Tabs can be resized from all 8 directions (4 edges + 4 corners) and size persists.

### Steps:

1. **Open WP 1, open WP QT 1 at center (400px, 300px, 800px × 600px)**
   - Action: Navigate to Wikipedia, press Q, drag to center, resize to 800px × 600px
   - Expected: QT 1 positioned and sized correctly

2. **Resize from top edge (decrease height by 100px)**
   - Action: Drag top edge handle downward
   - Expected: Height becomes 500px, top edge moves down, bottom edge stays fixed

3. **Resize from right edge (increase width by 100px)**
   - Action: Drag right edge handle to the right
   - Expected: Width becomes 900px, right edge moves, left edge stays fixed

4. **Resize from bottom-right corner (increase both by 50px)**
   - Action: Drag bottom-right corner handle diagonally
   - Expected: Width becomes 950px, height becomes 550px

5. **Resize from top-left corner (decrease both by 100px)**
   - Action: Drag top-left corner handle diagonally inward
   - Expected: Width becomes 850px, height becomes 450px, top-left corner moves

6. **Resize from left edge (decrease width by 50px)**
   - Action: Drag left edge handle to the right
   - Expected: Width becomes 800px, left edge moves, right edge stays fixed

7. **Verify final size persists across tabs**
   - Action: Switch to YT 1 (new tab)
   - Expected: QT 1 appears at (400px, 300px) with 800px × 450px size (all resize operations persisted)

8. **Reload page**
   - Action: Press F5 in YT 1
   - Expected: After reload, QT 1 reappears with same position/size (persistence confirmed)

---

## Scenario 18: Z-Index Management & Layering

**Purpose:** Verify that Quick Tabs use proper z-index layering, with Manager Panel always on top, and clicking brings QTs to front.

### Steps:

1. **Open WP 1, open WP QT 1 & QT 2 (overlapping)**
   - Action: Press Q twice, position QT 2 to partially overlap QT 1
   - Expected: QT 2 on top initially (created last)

2. **Click on QT 1 content area**
   - Action: Click inside QT 1 iframe
   - Expected: QT 1 z-index increases, moves to front, overlaps QT 2

3. **Click on QT 2 toolbar**
   - Action: Click QT 2 title bar
   - Expected: QT 2 z-index increases, moves to front, overlaps QT 1

4. **Open Manager Panel**
   - Action: Press Ctrl+Alt+Z
   - Expected: PM appears with z-index 999999999 (always above all QTs)

5. **Position Manager to overlap both QTs**
   - Action: Drag PM to overlap QT 1 and QT 2
   - Expected: PM always on top, QTs behind PM

6. **Click on QT 1**
   - Action: Click QT 1 while PM overlaps
   - Expected: QT 1 z-index increases but still below PM

7. **Close Manager Panel**
   - Action: Click close (✕) on PM
   - Expected: PM closes, QT 1 now topmost QT

8. **Verify z-index order: PM > QT (clicked) > QT (not clicked)**
   - Action: Reopen PM, click QT 2, observe layering
   - Expected: Manager Panel always highest, clicked QTs brought to front within QT layer

---

## Scenario 19: Container Isolation - No Cross-Container Migration

**Purpose:** Verify that Quick Tabs cannot migrate between Firefox containers and remain isolated to their original container.

### Steps:

1. **Open WP 1 in FX 1 (default container), open WP QT 1**
   - Action: Navigate to Wikipedia in default container, press Q
   - Expected: QT 1 created in FX 1 context

2. **Open WP 2 in FX 2 (Personal container)**
   - Action: Right-click new tab → "Personal" container, navigate to Wikipedia
   - Expected: WP 2 in Personal container (FX 2)

3. **Open Manager in FX 2**
   - Action: Press Ctrl+Alt+Z in WP 2
   - Expected: PM shows "Default Container" section with QT 1, "Personal Container" section empty

4. **Attempt to drag QT 1 from FX 1 to FX 2** (conceptual test)
   - Action: Try to force QT 1 to appear in FX 2 context
   - Expected: QT 1 does NOT appear in WP 2 (container boundary enforced)

5. **Open WP QT 2 in FX 2**
   - Action: Press Q in WP 2
   - Expected: QT 2 created in FX 2 context

6. **Verify Manager grouping**
   - Action: Open Manager in WP 2
   - Expected: PM shows two sections:
     - "Default Container" with QT 1
     - "Personal Container" with QT 2

7. **Switch to WP 1 (FX 1)**
   - Action: Click WP 1 tab
   - Expected: Only QT 1 visible (QT 2 isolated to FX 2)

8. **Verify no cross-container visibility**
   - Action: Open Manager in WP 1
   - Expected: PM shows same two sections, but QTs respect container boundaries

---

## Scenario 20: Container Clean-Up After All Tabs Closed

**Purpose:** Verify that when all tabs in a specific container are closed, all associated Quick Tabs and Manager state are properly cleaned up.

### Steps:

1. **Open WP 1 in FX 2 (Personal container), open WP QT 1**
   - Action: Open Wikipedia in Personal container, press Q
   - Expected: QT 1 created in FX 2 context

2. **Open YT 1 in FX 2, open YT QT 2**
   - Action: In same container, navigate to YouTube, press Q
   - Expected: QT 2 created in FX 2 context

3. **Verify both QTs in FX 2**
   - Action: Open Manager
   - Expected: PM shows "Personal Container" section with QT 1 and QT 2

4. **Close WP 1 (first tab in FX 2)**
   - Action: Close WP 1 tab
   - Expected: WP 1 closes, QTs persist in YT 1

5. **Close YT 1 (last tab in FX 2)**
   - Action: Close YT 1 tab
   - Expected: All FX 2 tabs closed

6. **Open new WP 2 in FX 2** (fresh tab in same container)
   - Action: Open new Personal container tab, navigate to Wikipedia
   - Expected: WP 2 loads

7. **Open Manager in WP 2**
   - Action: Press Ctrl+Alt+Z
   - Expected: PM shows "Personal Container" section EMPTY (QTs cleaned up)
   - No old QTs from previous session

8. **Verify clean state**
   - Action: Check viewport and storage
   - Expected: No Quick Tabs visible, FX 2 container state reset

---

## Implementation Notes for Testing

### Test Bridge API Usage

All scenarios can be tested programmatically using the Test Bridge API (`window.__COPILOT_TEST_BRIDGE__`) with `TEST_MODE=true`:

```javascript
// Example test code for Scenario 1
await window.__COPILOT_TEST_BRIDGE__.createQuickTab('https://example.com');
const tabs = await window.__COPILOT_TEST_BRIDGE__.getQuickTabs();
expect(tabs).toHaveLength(1);
```

### Cross-Tab Testing

Use Playwright's multi-page context to simulate multiple browser tabs:

```javascript
const page1 = await context.newPage();
const page2 = await context.newPage();
// Test cross-tab sync
```

### Container Testing

Firefox containers require specific profile configuration in Playwright fixtures to properly test container isolation.

### Timing Considerations

- BroadcastChannel sync: <100ms typical latency
- Storage write/read: 50-200ms
- Extension initialization: 1-2 seconds
- Allow 500-1000ms wait after operations for sync completion

---

**End of Scenarios Document**

**Document Maintainer:** ChunkyNosher  
**Repository:** https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Last Review Date:** November 22, 2025
