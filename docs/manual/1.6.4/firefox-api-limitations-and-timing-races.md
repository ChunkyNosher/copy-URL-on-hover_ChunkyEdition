# Quick Tabs: Firefox WebExtensions API Limitations & Architectural Race Conditions

**Quick Tabs Manager - API Constraints & Cross-Component Coordination Issues**  
**Extension Version:** v1.6.3.1–v1.6.4.14  
**Date:** 2025-12-16  
**Status:** Critical – Seven API-level and architectural timing issues not previously documented

---

## Executive Summary

Extended repository scan and comprehensive Firefox WebExtensions API documentation review revealed seven critical issues rooted in Firefox API limitations and architectural timing assumptions. These issues are distinct from and complementary to the previous 6 issues (logging, messaging, constants, deduplication, initialization barriers, dead code).

All seven issues stem from **undocumented Firefox API constraints** that the current architecture does not account for:

1. **Sidebar cannot identify tab context** – No access to `browser.tabs` API; cannot correlate storage events
2. **Content script initialization timing is unpredictable** – Fires at `document_idle`, after page events
3. **Storage events arrive in arbitrary order** – No guaranteed ordering even for sequential writes
4. **Content scripts cannot access tab APIs** – Architectural limitation of WebExtensions
5. **Tabs.onUpdated fires too early** – Before content scripts inject and listen
6. **Background script terminates after idle** – 30-second timeout in Firefox can interrupt state saves
7. **Cross-domain navigation unloads content script** – Quick Tabs disappear on domain switch within tab

These issues directly impact test scenarios from issue-47-revised.md and cause data consistency failures.

---

## Issues Overview

| Issue | Component | Severity | Root Cause | Impact | Test Scenarios Affected |
|-------|-----------|----------|-----------|--------|--------------------------|
| **7** | Sidebar Context | **Critical** | No tabId in sidebar; cannot call browser.tabs API | Cannot identify source tab of storage events | 4, 11, 13 |
| **8** | Content Script Timing | **High** | Injects at document_idle, not DOMContentLoaded | Hydration fails during rapid tab switches | 11, 17, 20 |
| **9** | Event Ordering | **High** | storage.onChanged fires in arbitrary order | Revision checks skipped when events arrive out-of-order | 10, 17 |
| **10** | Tab API Access | **Medium** | Content scripts cannot call browser.tabs.* | Cannot enumerate tabs or get tabId from content context | 4, 11 |
| **11** | Tabs.onUpdated Timing | **High** | Fires status=complete before content script loads | Messages sent to unready content scripts lost | 11 |
| **12** | Background Idle Timeout | **High** | Firefox terminates after 30s without activity; storage writes don't reset timer | State loss during shutdown or idle periods | 10, 21 |
| **13** | Cross-Domain Navigation | **Medium** | Navigation unloads origin-scoped content script | Quick Tabs disappear when user navigates in same tab | 20 |

---

## Issue 7: Sidebar Cannot Identify Tab Context (CRITICAL API LIMITATION)

### Problem

Sidebar panels are fundamentally not browser tabs and cannot access `browser.tabs` API. When sidebar receives `storage.onChanged` event, it has **no information about which tab triggered the change**.

Evidence:
- MDN docs (tabs.getCurrent): "Only works in contexts where there is a browser tab"
- Sidebar has no associated `tabId`
- `storage.onChanged` callback provides only: `changes` and `areaName` – NO sender information
- Firefox Discourse (2024-08-17): "Sidebars aren't assigned a tabId"

### Root Cause

File: `sidebar/quick-tabs-manager.js`  
Location: Storage listener setup (~lines 1400-1550), tab tracking logic throughout

The architecture assumes sidebar can:
1. Receive storage event (works)
2. Determine which tab changed (FAILS – no sender info available)
3. Apply changes only to that tab's UI (FAILS – wrong assumptions)

Sidebar has no way to validate: "Did this change come from WP tab 1 or WP tab 2?"

### Fix Required

Restructure tab coordination model:

1. **Add tab context to storage structure** – Never store bare state; include originTabId with every write
2. **Use hierarchical storage keys** – Instead of flat state, use `quick_tabs_tabId_1_state`, `quick_tabs_tabId_2_state`
3. **Sidebar queries ALL tab states** – Retrieve everything on each storage.onChanged, don't assume single source
4. **Background becomes coordinator** – Background script knows tab context; responsible for notifying sidebar of changes
5. **Implement request/response pattern** – Sidebar asks background: "What's the state for all tabs?" instead of trying to infer

---

## Issue 8: Content Script Initialization Fires After Page Lifecycle Events (HIGH TIMING RACE)

### Problem

Content scripts registered via `manifest.json` inject at `document_idle`, which occurs **after** `DOMContentLoaded` and `window.load` events have already fired.

Current implementation likely listens for these events:
```javascript
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('load', init);
```

By the time content script loads, these listeners will **never fire** because events already passed.

Evidence from documentation:
- MDN (document_idle): "Injected between document_end and window.onload completion"
- StackOverflow (2020-10-16): "Content scripts run AFTER DOMContentLoaded always"
- Firefox behavior: Events fire before content script injection regardless of timing

### Root Cause

File: `src/content-scripts/quick-tabs-content.js`  
Location: Initialization code (~lines 1-150)

Architectural assumption: Content script can wait for page ready events.

Reality: Page already ready by injection time; event listeners never trigger.

### Fix Required

Eliminate event-based initialization pattern:

1. **Execute initialization immediately** – No listeners for DOMContentLoaded/load
2. **Detect current page state** – Check `document.readyState` and DOM properties directly
3. **Add beforeunload listener** – Emergency save state when tab unloading
4. **Implement origin detection** – Content script must know its own origin for filtering stored QTs
5. **Send ready message to background** – Content script tells background when initialized; background responds with hydration

---

## Issue 9: Storage.onChanged Events Arrive in Arbitrary Order (HIGH DATA CONSISTENCY)

### Problem

When multiple `storage.local.set()` calls execute in sequence, corresponding `storage.onChanged` listeners may receive events **in completely different order** than writes occurred.

From Firefox behavior (confirmed 2018-2025):
- Write 1: revision=100
- Write 2: revision=101
- Events fire: listener receives revision=101 THEN revision=100 (reverse order)

Current deduplication logic (Issue 4) depends on monotonic revision ordering:
```javascript
if (revision > lastRenderedRevision) { render(); }
```

When events arrive out-of-order:
- Event 1 (rev=101): 101 > lastRendered(0) → RENDER, set lastRendered=101
- Event 2 (rev=100): 100 < lastRendered(101) → SKIP (WRONG! Should have rendered)

Result: State update silently dropped.

Evidence:
- MDN (storage.onChanged): "The order listeners are called is **not defined**"
- Firefox Bug 1851373: Confirms storage events are buffered and fired asynchronously
- Stack Overflow (2024-02-08): "Can listeners receive events in different order? Yes"

### Root Cause

File: `background.js`, `sidebar/quick-tabs-manager.js`  
Location: Storage write patterns (multiple sequential writes), storage.onChanged dedup logic

Architecture does multiple `storage.local.set()` calls without batching:
```javascript
storage.local.set({ rev: 101 });  // Write 1
storage.local.set({ state: {...} }); // Write 2 – Events may arrive in reverse order
```

### Fix Required

Implement atomic write pattern:

1. **Single batched write per operation** – Combine all changes into ONE `storage.local.set({...})` call
2. **Add content hash validation** – If two events have same state hash, skip second
3. **Deduplicate by state, not revision** – Compare entire state object, not just version number
4. **Implement transaction semantics** – Write version + state + checksum together atomically
5. **Add logging for out-of-order detection** – Track when events arrive out of expected order

---

## Issue 10: Content Scripts Cannot Access Browser.tabs API (MEDIUM ARCHITECTURAL CONSTRAINT)

### Problem

Content scripts have restricted API access by WebExtensions design:
- ✗ `browser.tabs.query()` → Undefined (throws error or silently fails)
- ✗ `browser.tabs.getCurrent()` → Undefined in content context
- ✗ `browser.tabs.onUpdated` → Undefined
- ✓ `browser.tabs.getCurrent()` → Available ONLY in background and sidebar
- ✓ `browser.runtime.sendMessage()` → Available
- ✓ `browser.storage.local` → Available

If content script attempts to enumerate tabs or call `browser.tabs.getCurrent()` for any reason other than getting its own tab ID, it will fail silently.

Evidence:
- MDN WebExtensions docs: "Content scripts have access to a limited set of APIs"
- StackOverflow (2019-03-05): "Only background scripts can access browser.tabs API"
- Firefox documentation: Content scripts isolated from privileged APIs

### Root Cause

File: `src/content-scripts/quick-tabs-content.js`  
Location: Any code attempting tab enumeration or listing

WebExtensions content scripts are sandboxed specifically to prevent scripts from:
- Enumerating user's tabs
- Accessing browser tab metadata
- Making privileged browser operations

This is a security model, not a bug.

### Fix Required

Restructure tab-dependent operations to run in background:

1. **Move tab enumeration to background.js** – Content scripts cannot call `browser.tabs.query()`
2. **Use sendMessage for tab info requests** – Content script asks background for tab list
3. **Document API boundaries in code** – Mark which APIs unavailable in content context
4. **Validate API availability at runtime** – Don't assume content script can access tabs
5. **Implement capability detection** – Check if `browser.tabs` exists before using

---

## Issue 11: Tabs.onUpdated Fires Before Content Scripts Load (HIGH TIMING RACE)

### Problem

Timeline when user navigates or page reloads:

1. T=0ms: Navigation starts
2. T=50ms: `browser.tabs.onUpdated` fires with `status=loading`
3. T=100ms: HTML begins parsing
4. T=300ms: HTML parsing completes, `status=complete` fires
5. T=350ms: **Content script actually injects and starts listening**

Background script often sends messages on `status=complete`, but content script **not yet listening**:

```javascript
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // Content script NOT injected yet!
    browser.runtime.sendMessage(tabId, { action: 'HYDRATE' });
  }
});
```

Evidence:
- StackOverflow (2021-04-15): "tabs.onUpdated with status=complete fires too quickly. DOM not ready."
- Chrome Extension docs: Same behavior in both Chrome and Firefox

### Root Cause

File: `background.js`  
Location: Tab lifecycle handlers (browser.tabs.onUpdated listener)

Architecture assumes `status=complete` means content scripts ready. Reality: HTML done, but content injection pending.

### Fix Required

Implement reliable ready-state communication pattern:

1. **Remove reliance on status=complete** – Too early, content script may not be listening
2. **Use webNavigation.onDOMContentLoaded** – More reliable timing for DOM ready
3. **Implement content script ready handshake** – Content script sends "READY" message after initialization
4. **Background sends hydration on ready receipt** – Only hydrate after confirmed content script listening
5. **Add retry/timeout for hydration** – If hydration message times out, fallback to storage-based hydration
6. **Log hydration attempts** – Track success/failure of message delivery during navigation

---

## Issue 12: Firefox Terminates Background Script After 30 Seconds Idle (HIGH STATE LOSS RISK)

### Problem

Firefox (MV3 and event-page enabled MV2) terminates background scripts after 30 seconds of inactivity to save resources.

Critical constraint: **Storage write operations do NOT reset the idle timer.**

Timeline:
1. T=0s: User closes browser
2. T=0s: Background script begins final state save to storage
3. T=0.1s: Write completes (assuming <100ms)
4. T=0.1s: Background becomes idle (no messages, no alarms)
5. T=30.1s: Firefox terminates background script
6. **Result:** If final save still pending after 30s, state lost

Evidence:
- Firefox Bug 1851373 (2023-2025): "Firefox terminates WebExtensions after 30 seconds idle"
- Bug discussion: Storage operations do NOT extend idle timeout
- Solution in bug tracker: Use alarms or persistent background to prevent termination

### Root Cause

File: `background.js`  
Location: Shutdown handling, state persistence logic

Architecture assumes background remains alive to complete final writes. Reality: Firefox kills background regardless.

### Fix Required

Implement keepalive and graceful shutdown patterns:

1. **Set periodic alarms** – Every 20 seconds, background receives alarm (resets idle timer)
2. **Implement onSuspend handler** – Save state when Firefox notifies background of termination
3. **Batch writes efficiently** – Don't split state across multiple storage operations
4. **Use persistent background if available** – MV2 with `"persistent": true` (if supported)
5. **Content scripts send keepalive** – Periodic messages from content scripts to background (resets timer)
6. **Defer non-critical operations** – Only write essential state before idle threshold

---

## Issue 13: Cross-Domain Navigation Unloads Content Script (MEDIUM HYDRATION ISSUE)

### Problem

When user navigates tab to different domain, origin-scoped content script unloads:

Timeline (user navigates Wikipedia→YouTube in same tab):
1. User in tab: `https://wikipedia.org`, content script running
2. Content script created Quick Tab (QT 1, stored in storage with originTabId=1)
3. User clicks link to YouTube
4. T=0ms: Wikipedia content script unloads (different origin, different script context)
5. T=50ms: New page begins loading
6. T=200ms: YouTube content script loads (if manifest registered for youtube.com)
7. **QT 1 has disappeared from DOM** – Wikipedia script unloaded, took DOM elements with it

Key issue: Storage still contains QT 1, but content script changed. New content script (YouTube) doesn't load Wikipedia's QTs.

If storage filtering not properly implemented:
- YouTube content script might load Wikipedia's QTs (cross-domain state leak)
- Manager sidebar shows QTs from wrong domain
- Tab ID filtering broken if not enforced per-origin

Evidence:
- Browser behavior: Content scripts are per-origin; unload on domain switch
- From issue-47-revised.md Scenario 20: "QT 1 may disappear briefly during page reload"

### Root Cause

File: `src/content-scripts/quick-tabs-content.js`  
Location: Hydration/filtering logic (~lines 200-350)

Architecture may not:
1. Detect current origin (document.location.origin)
2. Filter stored QTs by origin before hydrating
3. Handle content script unload event
4. Validate that content script only loads QTs for its own origin

### Fix Required

Implement origin-aware state management:

1. **Content script detects its origin** – Store `document.location.origin` on initialization
2. **Filter stored state by origin** – Only hydrate QTs created in current origin
3. **Add origin validation on hydration** – Verify stored originTabId matches current context
4. **Handle unload gracefully** – Save state on `beforeunload` before navigation
5. **Prevent cross-origin state leakage** – Never load QTs from different domain into current content script
6. **Log origin mismatches** – Detect and report if state hydrated for wrong origin

---

## Supporting Context

<details>
<summary>Firefox API Constraints Summary</summary>

From Mozilla Developer Network and Firefox Bug Tracker (2023-2025):

### 1. Sidebar Tab Context Limitation

Per MDN tabs.getCurrent() documentation:
- "Note: This function is only useful in contexts where there is a browser tab."
- Sidebar panels explicitly **not** considered browser tabs
- No way to retrieve `browser.tabs.query()` results from sidebar
- `storage.onChanged` callback provides no sender identification

### 2. Content Script Injection Timing

Per MDN document_idle and Firefox behavior:
- Content scripts inject after `DOMContentLoaded` has fired
- No guarantee about exact timing relative to page events
- `document.readyState` already "complete" or "interactive"
- Cannot reliably use event listeners for page ready detection

### 3. Storage Event Ordering Guarantee

Per MDN storage.onChanged and Firefox Bug 1851373:
- "The order listeners are called is not defined"
- Events buffered and fired asynchronously at task end
- Multiple sequential writes can have listeners fire in any order
- No reliable way to predict ordering

### 4. Content Script API Access Restrictions

Per MDN WebExtensions API documentation:
- Content scripts: Limited to messaging, storage, runtime APIs
- Restricted from: tabs, windows, alarms, webRequest APIs
- Security model: Prevent untrusted page scripts from accessing privileged APIs
- Error behavior: Undefined or silent failure for unavailable APIs

### 5. Tabs.onUpdated Timing

Per MDN tabs.onUpdated and StackOverflow (2021-2024):
- `status=complete` fires when HTML parsing done
- Content scripts inject at `document_idle` (later)
- Race condition: Background sends message before content listens
- Solution: Implement handshake pattern (content script ready notification)

### 6. Background Script Idle Termination

Per Firefox Bug 1851373 (2023-2025):
- MV3 and event-page MV2: Background terminates after 30s idle
- Storage operations do NOT reset idle timer
- Only alarms, messages, and certain API calls reset timer
- Solution: Set periodic alarms or use persistent background

### 7. Content Script Lifecycle on Navigation

Per WebExtensions content script behavior:
- Content scripts are per-origin (domain-specific)
- Navigation to new domain unloads old script, loads new script
- Cross-domain state requires explicit filtering
- Hydration must validate origin context

</details>

<details>
<summary>Relationship to Test Scenarios (issue-47-revised.md)</summary>

### Scenario Mapping to New Issues

**Scenario 4: Quick Tabs Manager - Display Grouped by Origin Tab**
- Issue 7: Sidebar cannot determine which tab storage change came from
- Issue 10: Content script cannot enumerate tabs to send info to sidebar

**Scenario 10: Quick Tab Persistence Across Browser Restart**
- Issue 12: Background script terminated before final state save completes

**Scenario 11: Hydration on Page Reload**
- Issue 8: Content script initialization after DOMContentLoaded misses page ready
- Issue 11: Hydration message sent on status=complete but content script not listening
- Issue 13: Reloading Wikipedia tab; hydration must filter QTs by origin

**Scenario 13: Position/Size Changes Don't Affect Other Tabs**
- Issue 7: Sidebar cannot determine which tab initiated position change

**Scenario 17: Rapid Tab Switching**
- Issue 8: Content script loading during rapid tab switch
- Issue 9: Storage events arrive out-of-order, dedup skips updates

**Scenario 20: Cross-Domain Navigation in Same Tab**
- Issue 8: Quick Tabs disappear during navigation; content script unloading
- Issue 13: Wikipedia content script unloads on YouTube navigation; QT 1 gone from DOM

**Scenario 21: Memory and Storage Impact**
- Issue 12: Background idle timeout interrupts final storage cleanup

</details>

---

## Acceptance Criteria

### All Seven Issues

- [ ] Issue 7: Sidebar cannot identify tab context documented; architecture requires originTabId in all storage writes
- [ ] Issue 8: Content script initialization immediate (no DOMContentLoaded listener); ready handshake implemented
- [ ] Issue 9: Single atomic write pattern for storage; no sequential storage.local.set() calls
- [ ] Issue 10: All browser.tabs API calls moved to background.js; content scripts use sendMessage
- [ ] Issue 11: Hydration via content script ready notification; status=complete not used for content sync
- [ ] Issue 12: Periodic alarms set (every 20s) to prevent background idle termination
- [ ] Issue 13: Content script filters stored Quick Tabs by origin; hydration validates originTabId

### Testing

- [ ] Scenario 4: Manager correctly displays Quick Tabs grouped by origin tab (no cross-tab state leakage)
- [ ] Scenario 11: Quick Tabs restore after page reload with correct origin filtering
- [ ] Scenario 17: Rapid tab switching (100ms intervals) doesn't cause state loss
- [ ] Scenario 20: Cross-domain navigation (Wikipedia→YouTube→Wikipedia) restores correct QTs
- [ ] Manual test: Close browser mid-operation; state persists on restart (not lost to idle timeout)
- [ ] Manual test: Multiple Quick Tabs in different tabs sync correctly
- [ ] Automated: No API errors in browser console (e.g., "undefined function")
- [ ] Automated: Storage event ordering test confirms dedup works regardless of event arrival order

---

## Priority & Complexity

| Issue | Priority | Complexity | Est. Effort | Blocking |
|-------|----------|-----------|-------------|----------|
| Sidebar Tab Context | Critical | High | 6-8 hours | Issues 1, 2 |
| Content Script Timing | High | High | 5-7 hours | Issues 8, 11 |
| Event Ordering | High | Medium | 3-4 hours | Issue 9 |
| Tab API Access | Medium | Medium | 2-3 hours | Issue 10 |
| Tabs.onUpdated Timing | High | High | 4-6 hours | Issue 11 |
| Background Idle | High | Medium | 3-4 hours | Issue 12 |
| Cross-Domain Navigation | Medium | Medium | 3-4 hours | Issue 13 |

**Total Estimated Effort:** 26–36 hours  
**Combined with Issues 1-6:** 40–57 hours total  

**Recommended Approach:**
1. **Phase 1 (Foundation):** Fix Issue 7 (sidebar context), Issue 10 (API access) – enables other fixes
2. **Phase 2 (Stability):** Fix Issue 12 (background idle), Issue 9 (event ordering) – prevents data loss
3. **Phase 3 (Correctness):** Fix Issue 8, 11, 13 (timing/navigation) – fixes test scenarios

---

## Implementation Dependencies

**Issue 7 must be fixed before:**
- Issue 1 (Logging) – Sidebar needs to know which tab's logs to capture
- Issue 2 (Runtime Messages) – Sidebar needs to identify message source

**Issue 10 must be fixed before:**
- Issue 7 – Cannot coordinate tab info without browser.tabs in background
- Issue 4 (from previous report) – Dedup needs background to coordinate writes

**Issue 12 must be fixed before:**
- Any state persistence improvements – Background will be killed anyway

---

## Known Limitations (Not Fixable)

These are Firefox WebExtensions design constraints that cannot be worked around:

1. ✗ **Sidebar cannot get tabId** – Fundamental API limitation
2. ✗ **Storage.onChanged has no sender info** – Firefox design choice
3. ✗ **Content scripts cannot access tabs** – Security model
4. ✗ **Event ordering not guaranteed** – Firefox scheduler design

**Workaround strategy:** Architecture must assume these limitations exist and implement request/response patterns instead of relying on events.

---

## Version History

- **v1.0** (Dec 16, 2025) – Seven Firefox API limitation issues documented from extended codebase audit

---

**Report Status:** Ready for GitHub Copilot Coding Agent Implementation  
**Next Steps:** Pair with previous comprehensive-logging-and-gaps-diagnostic.md; coordinate fixes across both reports  
**Critical Path:** Fix sidebar context (Issue 7) and API access (Issue 10) first – blocks other improvements  
**Validation:** Test against all 21 scenarios in issue-47-revised.md after implementation

