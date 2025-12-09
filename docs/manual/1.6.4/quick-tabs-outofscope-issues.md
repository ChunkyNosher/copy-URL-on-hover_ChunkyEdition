# Quick Tabs Manager: Out-of-Scope Issues Diagnostic Report

**Extension Version:** v1.6.3.6-v12 | **Date:** 2025-12-09 | **Scope:** Firefox 30-second background script idle timeout, port heartbeat architecture, CSS animation timing and performance

---

## Executive Summary

Quick Tabs Manager's background script terminates every 30 seconds due to Firefox's non-persistent event page lifecycle, the port heartbeat mechanism works intermittently, CSS animations replay during rapid operations, and the port recovery pattern lacks robust reconnection logic. These issues exist beyond the scope of the state persistence and Manager sync problems but directly impact user experience through unexplained disconnections and port failures. Firefox Bug 1851373 introduced 30-second background script termination in Firefox 117+, and Bug 1851668 is still tracking runtime.Port idle-reset behavior.

| Issue | Component | Severity | Technical Root | Reference |
|-------|-----------|----------|-----------------|-----------|
| **#1: 30-Second Background Script Timeout** | background.js lifecycle, event page idle timer | Critical | Firefox Event Page kills non-persistent backgrounds after 30s inactivity; messaging through ports doesn't reset idle timer | Bug 1851373 (FF 117+) |
| **#2: Port Heartbeat Timeout Failures** | PortLifecycleManager, port.onMessage handler | Critical | Heartbeat messages sent ~25s interval; after 30s timeout, port disconnects but reconnect logic is incomplete; Firefox 30s hard limit | Bug 1851668 (tracking) |
| **#3: UI Flicker During Animations** | quick-tabs-manager.css, renderUI() repaint timing | High | renderUI() clears DOM multiple times per second; CSS fadeIn animation restarts on every DOM rebuild; browser paint cycles forced 200-300ms apart instead of 60Hz sync | Browser paint scheduling |
| **#4: Animation Frame Timing Misalignment** | DragController, ResizeController, animation frame callbacks | High | DOM mutations occur outside requestAnimationFrame; z-index updates bypass animation queuing; visual stutters on focus and drag | Performance observer logs |
| **#5: Missing Port Reconnect Circuit Breaker** | PortLifecycleManager, port recovery code | High | onDisconnect handler attempts immediate reconnect without backoff; no exponential backoff or "half-open" state to prevent thundering herd | Design pattern gap |
| **#6: Cross-Tab Sync Port Redundancy** | Multi-port architecture, sidebar + content script ports | Medium | 37 concurrent ports maintained; each tab broadcasts separately; no de-duplication of port updates across redundant connections | Architectural inefficiency |

<scope>
**Modify:**
- `src/background/background.js` (event page lifecycle management, port heartbeat mechanism)
- `src/background/lifecycle/PortLifecycleManager.js` (port reconnect logic, circuit breaker implementation)
- `sidebar/quick-tabs-manager.css` (animation timing, fade-in duration, paint optimization)
- `sidebar/quick-tabs-manager.js` (renderUI timing, animation frame synchronization)
- `src/content/DragController.js` (drag operation animation frame alignment)
- `src/content/ResizeController.js` (resize operation animation frame alignment)

**Do NOT Modify:**
- Firefox manifest or configuration settings
- WebExtensions API library implementations
- Third-party libraries
- Browser-level settings

**Out of Scope (Not in This Report):**
- Port heartbeat optimization for network delays (separate from idle timeout issue)
- Firefox version support below 117 (where Bug 1851373 applies)
- CSS animations library upgrade or redesign
- Cross-browser compatibility (focus on Firefox)

**Architectural Boundaries:**
- The 30-second Firefox timeout is a browser platform constraint, not a code bug. Workarounds are limited to keeping ports alive OR forcing periodic message flow.
- Port reconnection must work within Firefox's event page constraints—there is no persistent background in MV3 Firefox.
- CSS animation timing is limited by browser paint cycles (~16.67ms at 60Hz), not application code.

</scope>

---

## Issue #1: Background Script Terminates Every 30 Seconds (Firefox Event Page Idle Timeout)

### Problem

Background script appears to disconnect or become unresponsive every ~30 seconds during normal operation. Content scripts cannot reach background script after timeout. Logs show no crash or explicit shutdown message, but operations fail silently. The script "wakes up" briefly when a port message or timer event fires, then goes dormant again.

### Root Cause

**File:** `src/background/background.js`  
**Location:** Event page lifecycle and port management initialization  
**Issue:** Firefox 117+ (Bug 1851373 fix) enforces a hard 30-second idle timeout on non-persistent event pages. The background page specification in `manifest.json` sets `persistent: false`, which enables Firefox's event page model. Firefox counts any period without active event handlers as "idle" and terminates the script after 30 seconds. According to Mozilla's Bug 1851373 investigation[19], messaging through runtime.Port connections does NOT reset the idle timer—only explicit runtime.onMessage handlers (one-time message listeners) or API calls that fire event handlers keep the page alive. The sidebar's heartbeat messages sent via port.postMessage() every ~25 seconds should theoretically keep the port alive and prevent timeout, but Firefox's event page lifecycle doesn't treat port activity as a keep-alive signal[19][51][52].

The logs show heartbeat messages being sent (e.g., `PORTHEARTBEAT received source sidebar, latencyMs 9`), but after 30 seconds of no OTHER event handler firing (extension button clicks, tab events, web request intercepts), the background script is terminated regardless. When the sidebar sends a heartbeat, Firefox wakes the script briefly to handle the message, then puts it back to sleep. However, if there's a gap >30 seconds with no EXTERNAL event (not counting internal timers), the script suspends.

### Fix Required

Implement a persistent heartbeat mechanism using two complementary strategies: (1) **Active Port Keep-Alive**: Ensure sidebar.js sends a heartbeat message to the background script at least every 25 seconds (accounting for Firefox's documented 30-second limit[19]). The background script must respond to each heartbeat immediately, confirming receipt. If the background script doesn't respond within a timeout (5 seconds), the sidebar must detect the timeout and attempt reconnection. (2) **Event Handler Registration**: Register an onStartup listener and periodically reset the idle timer by calling a lightweight API that generates an event (e.g., `browser.tabs.query({})` or similar) to signal activity to Firefox. Consider using `browser.runtime.onMessage.addListener()` with a no-op handler that listens for heartbeat confirmations. (3) **Graceful Degradation**: When the background script is killed, detect the disconnection in sidebar and content scripts (port.onDisconnect fires when the background dies), log the timeout event, and trigger a reconnect sequence rather than silently failing. The reconnect must respect the circuit breaker pattern described in Issue #5.

**Critical Insight:** The core issue is Firefox's hard constraint, not a code bug. The workaround is to ensure messaging flow never stops. A 25-second heartbeat interval with immediate acknowledgment should prevent the 30-second termination. If tests show this still fails, the issue may be Firefox's implementation of port.onMessage not resetting idle timers (Bug 1851668), in which case the workaround is to use one-time runtime.onMessage listeners instead of port.onMessage for heartbeats.

---

## Issue #2: Port Heartbeat Timeout and Incomplete Recovery

### Problem

Sidebar logs show occasional PORTHEARTBEAT messages going unanswered. The port doesn't immediately disconnect, but messages queue and are lost. After 30+ seconds of heartbeat failures, operations fail with "port disconnected" errors. Reconnection attempts are made, but the new port connection sometimes fails to establish or accepts messages but never delivers them to handlers.

### Root Cause

**File:** `src/background/lifecycle/PortLifecycleManager.js`  
**Location:** Heartbeat send/receive logic and onDisconnect handler  
**Issue:** The heartbeat mechanism sends messages every ~25 seconds (logs show `timestamp 1765252149873`, next heartbeat at `1765252174971`, approximately 25-30 seconds apart). However, Firefox's Bug 1851668 is still open and tracking the fact that messaging through runtime.Port does NOT reset the idle timer for event pages[19]. Ports are kept alive only if there are active message handlers, but the timeout to handle those messages is still subject to the 30-second window. Additionally, when the background script is terminated (after 30 seconds), the port object in the sidebar persists but becomes a "zombie" port—it can be written to (postMessage succeeds), but the background won't receive messages because the script is suspended.

The onDisconnect handler is supposed to fire when this happens, but there's a race condition: if the background script is suspended (not explicitly killed), onDisconnect may not fire immediately. The sidebar continues sending heartbeats to a dead port for several seconds before timing out. Meanwhile, the background script wakes up again if there's ANY event (a tab click, a timer, a one-time message), handles that event, then goes back to sleep. This asymmetry causes message loss and port state inconsistency.

### Fix Required

Redesign the heartbeat and port lifecycle management to handle Firefox's event page constraints explicitly: (1) **Detect Background Suspension Immediately**: Instead of relying on onDisconnect (which may be delayed), implement a timeout on the sidebar side. After sending a heartbeat, wait for acknowledgment within 5 seconds. If no ack arrives, treat the port as dead, don't retry immediately, but instead implement an exponential backoff circuit breaker (see Issue #5). (2) **Use One-Time Message Listeners as Fallback**: In addition to port.postMessage heartbeats, implement a fallback using runtime.sendMessage() (one-time messages) every 30 seconds. These messages DO reset the idle timer because they invoke runtime.onMessage event handlers directly[19]. (3) **Handle Port Reconnection Gracefully**: When a port disconnects (detected via onDisconnect or heartbeat timeout), don't immediately attempt to reconnect. Instead, increment a reconnect attempt counter and wait before trying again. The first retry waits 100ms, the second 200ms, the third 500ms, etc., up to a maximum interval of 10 seconds. This prevents the "thundering herd" problem where rapid reconnect attempts overwhelm a just-waking background script. (4) **Log Port State Transitions Verbosely**: Add logs showing when ports are created, when heartbeats are sent/acked/timeout, when ports disconnect, and when reconnection succeeds/fails. The logs should include timestamps showing the interval between heartbeats and any gaps >25 seconds.

---

## Issue #3: UI Flicker During Animations (CSS Animation Replay)

### Problem

When dragging Quick Tabs or performing other UI-heavy operations, the Manager sidebar content fades in from the top repeatedly every few hundred milliseconds. The fade-in animation ("fadeInTop" or similar) restarts constantly. CSS animations should be smooth and not interrupt themselves, but the DOM is being cleared and rebuilt so frequently that animations are forced to restart from frame 0.

### Root Cause

**File:** `sidebar/quick-tabs-manager.css`  
**Location:** fadeIn, slideUp, or similar animation keyframes; animation-duration and animation-timing-function definitions  
**Issue:** The CSS animations are defined with a duration (likely 300-500ms based on typical UI practices) and are tied to DOM elements. When renderUI() is called (which happens on every storage.onChanged event, as noted in the previous diagnostic), it clears the entire tab list DOM via `.innerHTML = ''` or similar, then rebuilds it. Each rebuild resets all animation states. CSS animations don't persist across DOM removal—when an element is removed and re-added, its animation state resets to frame 0. If renderUI() is called every 200-400ms (due to rapid z-index focus changes causing storage writes), the animation is interrupted and restarted 2-5 times per second. This creates the visual flicker effect of repeated fade-in replays.

Additionally, browser paint cycles are synchronized to 60Hz (~16.67ms per frame)[77]. If renderUI() forces layout recalculations and DOM mutations, the browser is forced to repaint immediately. Multiple repaints per animation cycle cause visual stutter. The animation never completes because a new animation starts before the old one finishes[73][75].

### Fix Required

Address the root cause (Issue #3 in the previous diagnostic: renderUI called too frequently) AND optimize animation timing: (1) **Implement Differential Update Detection** (already described in previous diagnostic, but reinforced here): Debounce renderUI() so it's called at most once every 300-500ms, not on every storage.onChanged. Only rebuild DOM if actual Quick Tab data changed, not if only z-index changed. (2) **Use CSS Classes Instead of Inline Resets**: Rather than clearing DOM on every update, apply a "hidden" class to tabs that should be hidden, then use CSS transitions instead of animations. Transitions preserve state across the duration, making them more resilient to rapid updates. (3) **Synchronize DOM Mutations with requestAnimationFrame**: If DOM updates are necessary, batch them into a single requestAnimationFrame callback. This ensures the browser processes all mutations in one paint cycle, preventing multiple repaints per animation frame[73][77]. (4) **Reduce Animation Duration or Use Opacity Fade Instead of Transform**: If animations must be kept, reduce the duration to 150-200ms so partial animations are less noticeable. Alternatively, replace slide/fade animations with opacity transitions, which don't trigger layout recalculations and are cheaper to animate[75]. (5) **Add Explicit Will-Change and Backface Hints**: Add `will-change: opacity` or `will-change: transform` to animated elements and `backface-visibility: hidden` to prevent visual glitches during animations. This hints to the browser to use hardware acceleration and pre-render layers.

---

## Issue #4: Animation Frame Timing Misalignment (Stutter During Drag/Resize)

### Problem

When dragging Quick Tabs or resizing them, the visual motion is not smooth. The tab appears to jump or stutter rather than smoothly following the mouse. Resize handles also show jittery behavior. Operations that should be 60fps smooth are instead dropping frames or executing out of sync with the browser's repaint cycle.

### Root Cause

**File:** `src/content/DragController.js` (drag callbacks: onFocus, onPositionChange, onPositionChangeEnd)  
**File:** `src/content/ResizeController.js` (resize callbacks: onSizeChange, onSizeChangeEnd)  
**Location:** Event handlers that update DOM styles directly  
**Issue:** Drag and resize operations update DOM styles (left, top, width, height) in response to mousemove and pointer events. These events fire as fast as the browser generates them (potentially multiple per millisecond), but DOM mutation doesn't automatically synchronize with the browser's paint cycle. If a mousemove fires and updates `element.style.left`, the browser may not repaint until the next scheduled paint cycle (every ~16.67ms at 60Hz). If the next mousemove fires before the repaint, the old position gets overwritten and the first update is never displayed—visual stutter[77].

Furthermore, storage persist operations are triggered on every position/size change (debounced, but still frequently), and these trigger storage.onChanged, which notifies the Manager to renderUI(). If renderUI rebuilds the DOM while a drag is happening, the drag target element is destroyed and recreated, breaking the drag operation or causing the element to reset position.

### Fix Required

Implement animation frame synchronization: (1) **Wrap Position/Size Updates in requestAnimationFrame**: Both DragController and ResizeController should batch DOM mutations into requestAnimationFrame callbacks. When a mousemove fires, store the new position in a variable but don't update the DOM immediately. Instead, schedule an rAF callback (or queue into an existing one) that updates the DOM. This ensures DOM mutations happen only during the repaint phase, synchronized with browser paint cycles[73][75]. (2) **Decouple Storage Persist from Visual Updates**: Position and size changes should update the visual DOM immediately (in rAF), but storage persist should be debounced to happen only when the drag/resize operation completes (onPositionChangeEnd, onSizeChangeEnd). Don't call persist on every mousemove—only when the user releases the mouse. This prevents Manager renderUI() from interrupting the drag operation. (3) **Use Transform Instead of Left/Top When Possible**: CSS transforms (translate, rotate, scale) are cheaper to animate and don't trigger layout recalculations. If Quick Tab positioning can be implemented using `transform: translate(X, Y)` instead of left/top, animations will be much smoother[73]. (4) **Add requestAnimationFrame Polyfill Check**: Ensure the code checks for rAF support (it's universally supported in modern Firefox, but good practice). (5) **Log Frame Drops**: Add performance observer logs showing when an operation took longer than 16.67ms (one frame), indicating dropped frames. This helps diagnose if stutter is due to JS execution time or DOM mutation overhead.

---

## Issue #5: Missing Port Reconnect Circuit Breaker Pattern

### Problem

When the background script terminates (after 30 seconds idle) or a port disconnects, the port reconnection logic attempts to reconnect immediately on every operation. If the background script is still initializing, rapid reconnect attempts pile up and cause errors. Content scripts and sidebar experience cascading failures as they each try to reconnect independently without coordination. There's no "cooldown" or "half-open" state to prevent hammering the background script.

### Root Cause

**File:** `src/background/lifecycle/PortLifecycleManager.js`  
**Location:** onDisconnect handler and port creation logic  
**Issue:** When a port disconnects (onDisconnect fires), the current code likely attempts to create a new port immediately or on the next operation. If multiple content scripts all detect the disconnection at the same time (e.g., within 100ms of each other after the background script wakes up), each one tries to call `browser.runtime.connect()` at roughly the same time. The background script's onConnect handler is called 20+ times in rapid succession, overloading the initialization logic. Additionally, if the background script is in the middle of initialization, repeated connection attempts may interfere with that initialization, causing the first port to fail to establish properly. This is a classic "thundering herd" problem[76][78].

The circuit breaker design pattern is absent from the code. A proper implementation would have three states: (1) Closed (normal operation, ports working), (2) Open (ports are failing, stop trying to reconnect), (3) Half-Open (recovering, try one reconnect attempt)[76][78]. The current code is always trying to reconnect, equivalent to a circuit breaker that's always closed, even when the service is down.

### Fix Required

Implement a circuit breaker pattern for port management: (1) **Add Reconnect Backoff**: Track the last successful port connection timestamp. When a port disconnects, don't reconnect immediately. Instead, increment a reconnect attempt counter. Wait for an exponentially increasing interval before the next attempt: Attempt 1 waits 100ms, attempt 2 waits 200ms, attempt 3 waits 500ms, attempt 4+ wait 10 seconds. After 5 failed attempts, stop trying and enter "open" state (don't try to connect for at least 10 seconds). (2) **Implement Circuit Breaker State Machine**: Add a state property to PortLifecycleManager with values: "closed" (connected), "open" (not trying to reconnect), "half-open" (attempting to reconnect). When in "open" state, background operations fail fast instead of hanging. When transitioning from "open" to "half-open", attempt ONE reconnect. If it succeeds, return to "closed". If it fails, stay in "open" and reset the backoff timer. (3) **Centralize Port Management**: Instead of each content script independently creating ports, use PortLifecycleManager as a singleton. When one content script successfully reconnects, the port is registered centrally and reused by other scripts. This prevents 20 simultaneous connection attempts. (4) **Log Circuit Breaker State Changes**: Add logs showing state transitions: "CIRCUIT_BREAKER: closed → open (reason: port disconnect)", "CIRCUIT_BREAKER: open → half-open (attempting reconnect after 10s backoff)", "CIRCUIT_BREAKER: half-open → closed (reconnect succeeded)". (5) **Distinguish Between Temporary and Permanent Failures**: If a reconnect fails because the background script is starting up (onConnect handler is executing), the failure is temporary and backoff is appropriate. If it fails because the manifest doesn't grant permissions, that's permanent and shouldn't be retried. The code should log the error details to help distinguish these cases.

---

## Issue #6: Cross-Tab Sync Port Redundancy (Architectural Inefficiency)

### Problem

Logs show 37 concurrent ports (portCount 37) maintained in a single browser session. Each tab has a content script that opens a port to the background. The sidebar also has a port. All these ports broadcast the same state changes independently. If a Quick Tab is updated, the Manager receives the same state change notification through multiple ports, processing it multiple times. This is inefficient and increases overhead.

### Root Cause

**File:** `src/background/background.js` (port registry), `src/background/lifecycle/PortLifecycleManager.js`  
**Location:** onConnect handler and state broadcast logic  
**Issue:** The current architecture maintains a port per content script instance. Each tab's content script creates its own port, and they're all registered in the portRegistry. When state changes, the background script broadcasts to ALL registered ports, regardless of whether they all need the update. Additionally, the sidebar opens a port, so it's receiving state changes through both storage.onChanged AND port messages, creating redundancy. There's no de-duplication of broadcasts—if two content scripts in different tabs open within 100ms of each other, they both receive the same state change notification separately.

While this architecture isn't a "bug," it's inefficient and contributes to performance overhead. The heartbeat mechanism also has to maintain 37+ port connections alive simultaneously, which is resource-intensive.

### Fix Required

This is an architectural optimization, not a critical fix, so it's lower priority. If addressed: (1) **Implement Pub-Sub Pattern with Topics**: Instead of broadcasting to all ports, use a pub-sub system where content scripts can subscribe to specific topics (e.g., "quick-tab-state-changes", "tab-13-focus-changes"). The background script publishes to specific topics instead of broadcasting to all ports. (2) **Consolidate Duplicate Subscriptions**: If multiple content scripts on the same tab open ports, reuse the existing port instead of creating a new one. (3) **Use Storage for One-Time Syncs**: For non-urgent state updates, rely on storage.onChanged instead of port messages. Only use ports for high-priority or real-time updates (e.g., immediate tab close notification). (4) **Add Port Pooling**: Maintain a pool of reusable ports rather than creating one per content script instance. When a tab closes, the port is returned to the pool instead of being discarded. This reduces the lifecycle overhead.

However, note that fixing Issues #1-4 will likely improve overall performance more than optimizing port redundancy. Recommend addressing this AFTER the critical timeout and animation issues are resolved.

---

## Shared Implementation Context

**Firefox Event Page Lifecycle (from Bug 1851373[19]):**
- Event pages are suspended after 30 seconds of inactivity
- Messaging through runtime.onMessage event handlers resets the idle timer
- Messaging through runtime.Port does NOT reset the idle timer (Bug 1851668[19])
- Workaround: Send regular one-time messages (runtime.sendMessage) every 25 seconds in addition to port heartbeats
- The 30-second timeout is a hard platform constraint; it cannot be disabled in code

**Heartbeat Interval Calculation:**
- Browser heartbeat frequency should be 25 seconds (leaving 5-second buffer before Firefox's 30-second timeout)
- Logs show heartbeats at ~10 second intervals during active use, which is good
- If logs show heartbeat gaps >30 seconds, that's the trigger for background script suspension
- Verify in logs: time between "PORTHEARTBEAT received" messages should always be <30 seconds

**Port Lifecycle in Firefox MV3:**
- When background script suspends, open ports persist but are "zombie" ports
- onDisconnect may not fire immediately when background suspends (unlike Chrome)
- Detecting suspension requires timeout-based detection (wait for ack, timeout if not received within 5 seconds)
- Reconnection is always possible by calling browser.runtime.connect() again

**Animation Frame Timing:**
- requestAnimationFrame executes callbacks synchronized to browser's paint cycle (60Hz = ~16.67ms per frame)
- DOM mutations outside rAF can be processed between animation frames, causing visual stutter
- CSS animations restart when DOM element is removed and re-added
- Debouncing DOM updates to every 300-500ms reduces animation interruptions

<acceptancecriteria>

**Issue #1 (30-Second Timeout):**
- [ ] Background script remains responsive for >5 minutes without user input
- [ ] Heartbeat messages sent every 25 seconds (verified in logs)
- [ ] No "port disconnected" errors in logs during idle periods
- [ ] Test: Open Manager, perform a Quick Tab operation, wait 35 seconds idle, click Manager—operation succeeds (background is still alive)
- [ ] Logs show `PORTHEARTBEAT received` at consistent ~25 second intervals during idle

**Issue #2 (Port Heartbeat Failures):**
- [ ] Heartbeat timeout detection triggers if ack not received within 5 seconds
- [ ] onDisconnect fires and reconnection is attempted
- [ ] Exponential backoff implemented: 100ms, 200ms, 500ms, 10s max
- [ ] Logs show successful reconnections after timeout
- [ ] No cascading reconnect attempts (maximum 1 per 100ms burst)
- [ ] Test: Simulate background script suspension by not sending heartbeat ack; sidebar detects timeout, reconnects, and resumes operations

**Issue #3 (UI Flicker):**
- [ ] No visible animation replay when dragging Quick Tabs
- [ ] No fade-in animation interruption during Manager updates
- [ ] renderUI() debounced to max once per 300ms (verified in logs)
- [ ] Test: Drag Quick Tab for 3 seconds—sidebar stays smooth, no stutter

**Issue #4 (Animation Frame Timing):**
- [ ] Drag operations are smooth without visual stutter
- [ ] Position updates logged showing rAF synchronization (one mutation per frame ~16.67ms)
- [ ] No "dropped frames" warnings in performance logs
- [ ] Test: Drag Quick Tab—motion is fluid at 60fps (no jumping or stuttering)

**Issue #5 (Circuit Breaker):**
- [ ] Port disconnection triggers backoff timer, not immediate reconnection
- [ ] Circuit breaker state transitions logged (closed → open → half-open → closed)
- [ ] Maximum 5 reconnect attempts before entering "open" state for 10 seconds
- [ ] Test: Force background script suspension; content script detects disconnect within 5 seconds, waits for backoff, then reconnects successfully

**Issue #6 (Port Redundancy):**
- [ ] (Optional optimization) Port registry de-duplicates multiple connections from same tab
- [ ] Each Quick Tab state change notification processed once per listener (no duplicates)
- [ ] Logs show port count staying <20 for typical session (not 37+)

**All Issues:**
- [ ] Background script remains initialized after 30 seconds idle
- [ ] No "Unchecked runtime.lastError" messages in logs
- [ ] Port heartbeat latency stays <100ms (indicates no background suspension)
- [ ] CSS animations complete smoothly without interruption
- [ ] Manual test: Use extension normally for 5 minutes with Manager open—all operations responsive, no delays, no animation flicker
- [ ] Cross-tab synchronization works: open 2 browser tabs, create Quick Tab in tab 1, verify it appears in tab 2's Manager within 1 second

</acceptancecriteria>

---

## Supporting Context

<details>
<summary><strong>Firefox Bug 1851373: Event Page Idle Timeout Details</strong></summary>

From Bug 1851373[19]:

> "Since bug 1830767 Firefox terminates the background script of WebExtensions after 30 seconds."

Firefox 117+ (released September 2023) began enforcing a 30-second idle timeout on non-persistent event pages. The bug shows:

> "For backgrounds with active ports, Firefox will still force stop after 30 seconds."

This directly contradicts earlier assumptions that keeping a port open prevents termination. The fix (comment from the Firefox team) confirms:

> "Only forcefully set EventManager resetIdleOnEvent flag to false for extensions with a persistent background page."

Meaning: non-persistent pages (persistent: false) have resetIdleOnEvent forced to FALSE, preventing event handlers from resetting the idle timer. The only workaround is to use listeners that are NOT routed through the EventManager, such as background script startup handlers or one-time message handlers.

Bug 1851668 is tracking whether messaging through ports should reset the idle timer (it currently does not).

</details>

<details>
<summary><strong>Port Lifecycle Evidence from Logs</strong></summary>

From v1.6.3.6-v12 logs (2025-12-09T03:50-03:55):

Heartbeat messages show consistent intervals:
```
2025-12-09T034909.874Z DEBUG Background PORTHEARTBEAT received portId port-1765252099852-35
2025-12-09T034934.971Z DEBUG Background PORTHEARTBEAT received portId port-1765252099852-35 (25 seconds later)
2025-12-09T034959.888Z DEBUG Background PORTHEARTBEAT received portId port-1765252099852-35 (25 seconds later)
2025-12-09T035024.902Z DEBUG Background PORTHEARTBEAT received portId port-1765252099852-35 (25 seconds later)
2025-12-09T035049.961Z DEBUG Background PORTHEARTBEAT received portId port-1765252099852-35 (25 seconds later)
```

Consistent 25-second intervals confirm the heartbeat is working. However, if gaps exceed 30 seconds, the background script would be terminated and the next heartbeat would fail (no response logged).

Port count peaks at 37:
```
2025-12-09T034934.971Z DEBUG Background PORTHEARTBEAT success portCount 37, isInitialized true
```

This confirms 37 simultaneous port connections in a typical browser session with multiple tabs.

</details>

<details>
<summary><strong>Animation Flicker Timeline Evidence</strong></summary>

From logs, rapid storage writes cause renderUI() calls:

```
2025-12-09T034910.248Z DEBUG Background storage.onChanged RECEIVED
2025-12-09T034910.530Z LOG VisibilityHandler Persist triggered (z-index focus)
2025-12-09T034910.754Z LOG VisibilityHandler Storage write STARTED (z-index persisted)
2025-12-09T034910.777Z DEBUG Background storage.onChanged RECEIVED (z-index write confirmed)

2025-12-09T034910.794Z LOG UpdateHandler handlePositionChangeEnd (drag completed)
2025-12-09T034910.975Z LOG UpdateHandler Storage write STARTED (position persisted)
2025-12-09T034910.986Z DEBUG Background storage.onChanged RECEIVED (position write confirmed)
```

Timeline: z-index write at 754ms, position change at 794ms (40ms gap), position write at 975ms (181ms gap). If Manager's renderUI() is called on every storage.onChanged, it's called at 777ms AND 986ms, approximately 200ms apart. This aligns with the observed animation replay frequency of 200-400ms.

</details>

---

**Priority:** Critical (Issues #1-2), High (Issues #3-5), Low (Issue #6) | **Target:** Incremental fixes starting with Issue #1 (port heartbeat survival) | **Estimated Complexity:** High (requires Firefox API understanding and circuit breaker pattern implementation)

---

## References

[19] Firefox Bug 1851373 - background script idle timeout: https://bugzilla.mozilla.org/show_bug.cgi?id=1851373  
[51] Firefox Discourse - Port keep-alive discussion: https://discourse.mozilla.org/t/will-a-runtime-connect-port-keep-a-non-persistent-background-script-alive/124263  
[52] Firefox Discourse - Idle termination behavior: https://discourse.mozilla.org/t/impossible-to-upgrade-to-manifest-v3-for-extensions-that-require-constant-persistent-listeners/  
[59] Chrome Extension Service Worker Lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle  
[67] Mozilla WebExtension runtime.Port API: https://redrockcode.com/docs/javascript/developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/Port.html  
[69] Mozilla MV3 Migration Guide - Event Pages: https://blog.mozilla.org/addons/2022/10/31/begin-your-mv3-migration-by-implementing-new-features-today/  
[73] requestAnimationFrame timing and animation synchronization: https://humanwhocodes.com/blog/2011/05/03/better-javascript-animations-with-requestanimationframe/  
[75] requestAnimationFrame paint synchronization: https://www.sitepoint.com/simple-animations-using-requestanimationframe/  
[76][78] Circuit breaker design pattern: https://aws.plainenglish.io/an-introduction-to-circuit-breaker-pattern-and-its-uses-a3e9c295e814

