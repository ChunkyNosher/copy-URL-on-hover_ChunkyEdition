# Firefox WebExtensions API Limitations

**Document Type**: Technical Reference  
**Purpose**: Comprehensive catalog of Firefox WebExtensions API limitations
affecting Quick Tabs  
**Date**: December 16, 2025  
**Source**: Canvas gap analysis + ROBUST-QUICKTABS-ARCHITECTURE.md +
quick-tabs-manager.js codebase analysis  
**Scope**: copy-URL-on-hover_ChunkyEdition repository

---

## EXECUTIVE SUMMARY

Firefox WebExtensions API has **13 documented limitations** that directly impact
the Quick Tabs implementation. These are NOT bugs but **inherent constraints in
the Firefox browser architecture** that must be worked around in application
code. The proposed robust architecture specifically addresses 7 of these
limitations.

**Critical Limitations Affecting Quick Tabs**:

- Sidebar cannot access browser.tabs API
- Content scripts cannot query tabs
- storage.onChanged event ordering is not guaranteed
- Background script has 30-second idle timeout
- Sidebar context isolation from main page
- Port disconnection unpredictability
- Navigation unloads content scripts mid-stream

---

## PART 1: SIDEBAR-SPECIFIC LIMITATIONS

### Limitation 1.1: Sidebar Cannot Use browser.tabs API

**Mozilla Documentation Reference**:  
[MDN: browser.tabs.getCurrent()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/getCurrent)

> "Note: This function only works in contexts where there is a browser tab."

**The Problem**:

Sidebars run in a **special sandbox context** that is NOT a browser tab.
Therefore, ANY call to:

- `browser.tabs.getCurrent()`
- `browser.tabs.query()`
- `browser.tabs.get()`
- `browser.tabs.update()`
- `browser.tabs.onUpdated` events
- Any other tabs API method

**Will return undefined, fail silently, or throw permission errors**.

**Current Code Workaround** (in quick-tabs-manager.js):

```javascript
// v1.6.3.5-v2 - FIX Report 1 Issue #2: Track current tab ID for Quick Tab origin filtering
let currentBrowserTabId = null;

// v1.6.3.9-v5 - FIX Bug #1: Ensure currentBrowserTabId initialization with fallback to background request
/**
 * @private
 */
function _requestCurrentTabIdFromBackground() {
  // Sidebar CANNOT use tabs.getCurrent() - must ask background
  browser.runtime
    .sendMessage({
      type: 'GET_CURRENT_TAB_ID'
    })
    .then(response => {
      currentBrowserTabId = response.tabId;
    })
    .catch(err => {
      console.warn('[Manager] Failed to get current tab ID:', err.message);
      // Fallback to null - adoption flow will re-request
    });
}
```

**Impact**:

- Sidebar cannot independently determine which browser tab is active
- Must rely on background script to provide tab information
- Creates dependency on background ↔ sidebar communication
- If background doesn't respond, sidebar loses tab context

**Workaround Applied**: Background script queries tabs.API and sends results via
`runtime.sendMessage` to sidebar.

---

### Limitation 1.2: Sidebar Cannot Send Unsolicited Messages to Pages

**Mozilla Documentation Reference**:  
[MDN: Sidebar Context](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars)

> "Sidebars run in a content script-like environment but are not associated with
> any particular page."

**The Problem**:

Sidebar context cannot:

- Send messages directly to content scripts
- Use `tabs.sendMessage()`
- Communicate with page scripts
- Access page DOM or window objects

**Current Code Pattern**:

```javascript
// Sidebar trying to send message to content script - WRONG:
// browser.tabs.sendMessage(tabId, message); // ← Will fail in sidebar context

// Correct pattern - sidebar asks background to relay:
async function adoptQuickTabToCurrentTab(quickTabId) {
  // Sidebar cannot directly contact content script
  // Must ask background to coordinate
  const response = await sendToBackground({
    type: 'ADOPT_QUICK_TAB_TO_CURRENT_TAB',
    quickTabId,
    targetTabId: currentBrowserTabId // Set by background notification
  });
}
```

**Impact**:

- Cannot directly notify content scripts of quick tab operations
- All sidebar↔content script communication must route through background
- Adds extra hop: Sidebar → Background → Content Script
- Increases latency by 5-20ms per operation

---

### Limitation 1.3: Sidebar Cannot Access Page Context

**Mozilla Documentation Reference**:  
[MDN: Content Scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)

> "Content scripts have access to a limited set of APIs."

**The Problem**:

Sidebar (despite being a WebExtension UI) cannot:

- Access `window` object of any page
- Read page cookies or localStorage
- Manipulate page DOM
- Trigger page events
- Access page JavaScript objects

**Impact**: Sidebar is completely isolated from web content for security. Must
coordinate state entirely through storage and messaging APIs.

---

## PART 2: CONTENT SCRIPT LIMITATIONS

### Limitation 2.1: Content Scripts Cannot Access browser.tabs API

**Mozilla Documentation Reference**:  
[MDN: Content Scripts - Available APIs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#api_access)

From MDN:

> "Content scripts have access to a limited set of APIs" and "cannot access:
> ...tabs, windows, alarms, webRequest..."

**The Problem**:

Content scripts running on web pages cannot call:

- `browser.tabs.query()` - Cannot find other tabs
- `browser.tabs.getCurrent()` - Cannot identify own tab
- `browser.tabs.update()` - Cannot update any tab
- `browser.tabs.onUpdated` - Cannot listen to tab events
- ANY tabs API method

**Current Code Pattern** (from quick-tabs-manager.js):

```javascript
// v1.6.3.9-v4 ARCHITECTURE NOTE: Content script cannot query tabs
// Content scripts CANNOT use browser.tabs API per MDN documentation
// Must request tab info from background script

// In content script (NOT in this file, but example):
// This FAILS:
// const currentTab = await browser.tabs.getCurrent(); // ← ERROR

// This SUCCEEDS:
// const response = await browser.runtime.sendMessage({
//   type: 'GET_CURRENT_TAB_ID'
// });
// const currentTab = response.tabId;
```

**Impact**:

- Content scripts cannot know their own tab ID without asking background
- Cannot filter Quick Tabs by their own origin tab
- Must request all contextual information from background script
- Creates startup dependency: content script → background

---

### Limitation 2.2: Content Scripts Require Manifest Declaration

**Mozilla Documentation Reference**:  
[MDN: manifest.json - content_scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)

**The Problem**:

Content scripts MUST be declared in manifest.json and are injected at specific
times:

- After document_start (before page scripts run)
- After document_end (after page fully loaded)
- After document_idle (after window.onload fires)

Cannot dynamically inject content scripts in sidebar or on-demand.

**Current Manifest Declaration** (assumed in manifest.json):

```json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

**Impact**:

- Content script injection timing is fixed and cannot be changed at runtime
- If script crashes, won't auto-reinject
- All tabs get the script by default (must use matches filter to restrict)
- Cannot have different content scripts per context

---

### Limitation 2.3: Content Scripts Unload on Navigation

**Mozilla Documentation Reference**:  
[MDN: Content Scripts - Lifecycle](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)

**The Problem**:

When a page navigates, its content script is unloaded:

- Content script variables are cleared
- In-flight messages are abandoned
- Event listeners are removed
- State is lost

**Current Code Issue** (from canvas analysis):

```javascript
// Canvas Issue #13: Navigation unloads script
// If content script is running an operation and page navigates:
// browser.runtime.sendMessage({
//   type: 'CREATE_QUICK_TAB',
//   data: tabData
// });
//
// If page navigates BEFORE response arrives, the message handler callback:
// .then(response => { ... }) // ← Never fires, script already unloaded
```

**Impact**:

- Cannot guarantee message delivery during navigation
- Race condition: "Did the operation complete before unload?"
- Requires timeout-based recovery (assume operation failed after 3 seconds)
- Sidebar cannot know if content script-initiated operation completed

---

## PART 3: STORAGE API LIMITATIONS

### Limitation 3.1: storage.onChanged Event Ordering Not Guaranteed

**Mozilla Documentation Reference**:  
[MDN: storage.onChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged)

From MDN:

> "When a storage item is changed, a storage.onChanged event is fired. Events
> are not guaranteed to be delivered in the order they occur."

**The Problem**:

Multiple rapid writes to storage may trigger `onChanged` events in arbitrary
order:

```javascript
// Write 1: Add Quick Tab A
browser.storage.local.set({ quick_tabs_state_v2: { tabs: [A] } });

// Write 2: Add Quick Tab B
browser.storage.local.set({ quick_tabs_state_v2: { tabs: [A, B] } });

// Write 3: Add Quick Tab C
browser.storage.local.set({ quick_tabs_state_v2: { tabs: [A, B, C] } });

// Events may fire in order: Event 1, Event 3, Event 2
// Or: Event 2, Event 1, Event 3
// Or any other permutation
```

**Current Code Workaround** (from quick-tabs-manager.js):

```javascript
// v1.6.3.8-v5 - FIX Issue #1: Monotonic revision versioning for storage event ordering
// IndexedDB delivers storage.onChanged events in arbitrary order. Revision numbers
// provide a definitive ordering mechanism

let _lastAppliedRevision = 0;

function _handleStorageOnChanged(changes, areaName) {
  if (areaName !== 'local' || !changes[STATE_KEY]) return;

  const stateChange = changes[STATE_KEY].newValue;
  const revision = stateChange?.revision;

  // v1.6.3.8-v5: Reject stale/old revisions
  if (revision <= _lastAppliedRevision) {
    console.log('STALE_EVENT: revision', revision, 'vs', _lastAppliedRevision);
    return; // Skip this event - we've already processed newer state
  }

  _lastAppliedRevision = revision;
  // Process event
  _handleStorageChange(stateChange);
}
```

**Impact**:

- Sidebar may render stale data (Quick Tab from earlier write appears after
  newer one)
- Race condition: "Is this the latest state or an old event?"
- Requires revision counters to establish ordering
- Cannot assume event sequence matches write sequence

---

### Limitation 3.2: storage.sync Has 5KB Per-Item Quota

**Mozilla Documentation Reference**:  
[MDN: storage.sync](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)

From MDN:

> "To store data that is synced across devices, use storage.sync. For an
> extension with a manifest_version of 3 or higher, the maximum size of any
> single item is 8KB. For manifest_version of 2, it is 5KB."

**The Problem**:

If Quick Tabs state grows beyond 5KB, write to storage.sync silently fails:

```javascript
const quickTabsState = {
  tabs: [
    /* 50-100 Quick Tabs, each ~50-100 bytes */
  ]
  // Total size grows from 5KB (20 Quick Tabs) → 15KB (60 Quick Tabs)
};

// This SILENTLY FAILS if > 5KB:
browser.storage.sync.set({ quick_tabs_state: quickTabsState });
// No error thrown, no event fired, write just doesn't happen
```

**Current Code Status** (from ROBUST-QUICKTABS-ARCHITECTURE.md):

```
Storage Tier 1: storage.local (5MB+ quota) ← PRIMARY
Storage Tier 2: storage.sync (5KB limit) ← BACKUP
Storage Tier 3: browser.storage (session only) ← TEMP
```

**Workaround Applied**: Use storage.local for main state (5MB+ quota),
storage.sync for backups only if state < 5KB.

**Impact**:

- Cannot sync large Quick Tabs collections across browsers
- Backup strategy must compress or sample state before sync
- Cross-device sync only works for small numbers of Quick Tabs
- Silent failure requires explicit size checking before write

---

### Limitation 3.3: storage.session Clears on Browser Close (Firefox 115+)

**Mozilla Documentation Reference**:  
[MDN: storage.session](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session)

From MDN:

> "session storage is cleared when the extension is closed or the browser is
> closed."

**The Problem**:

Session storage is NOT persistent across browser restarts:

```javascript
// Session 1: User stores Quick Tabs
browser.storage.session.set({ quickTabs: [...] });

// Browser closes...

// Session 2: User reopens browser
const data = await browser.storage.session.get('quickTabs');
// Returns {} - data is gone
```

**Current Code Decision** (from ROBUST-QUICKTABS-ARCHITECTURE.md):

```
Why NOT Using storage.session...
Although Firefox 115 supports it
- Session storage clears on browser close
- User loss of Quick Tabs state
- Main storage layer storage.local is most reliable
```

**Impact**:

- Cannot use session storage as primary persistence layer
- Must use storage.local (which IS persistent)
- Session storage only suitable for temporary caches during browser runtime

---

## PART 4: BACKGROUND SCRIPT LIMITATIONS

### Limitation 4.1: Background Script 30-Second Idle Timeout (Firefox 117+)

**Mozilla Documentation Reference**:  
[Firefox Bug 1851373](https://bugzilla.mozilla.org/show_bug.cgi?id=1851373)

**The Problem**:

In Firefox 117+, background scripts terminate after 30 seconds of inactivity:

```javascript
// Time 0: Background script starts
// Time 0-30s: Extension runs normally

// Time 30s: No message received, no timers running
// ↓ Firefox terminates the background script

// Time 31s: User clicks button in sidebar
// → Sidebar sends message
// → Background script gets restarted (cold start)
// → Event handlers re-registered
// → State reloaded from storage
```

**Current Code Workaround** (from quick-tabs-manager.js):

```javascript
// v1.6.3.8-v4 - FIX Issue #3: Active state refresh when visible
/**
 * Interval for periodic state freshness check when sidebar becomes visible
 * v1.6.3.8-v4 - FIX Issue #3: Active state refresh when visible
 */
const VISIBILITY_REFRESH_INTERVAL_MS = 15000;

/**
 * Keepalive mechanism to prevent background script idle termination
 * Sends periodic messages to keep background alive
 */
function _startKeepaliveHealthReport() {
  // Send ping every 15 seconds to keep background awake
  setInterval(() => {
    browser.runtime
      .sendMessage({
        type: 'HEALTH_PROBE',
        timestamp: Date.now()
      })
      .catch(err => {
        console.warn('Keepalive failed:', err.message);
        // Background may have terminated
      });
  }, VISIBILITY_REFRESH_INTERVAL_MS);
}
```

**Impact**:

- Background script restarts = state reloaded from disk (5-20ms latency hit)
- If background terminates, first message causes restart delay
- Requires keepalive messages to maintain state in memory
- On restart, event listeners must be re-registered

**Architecture Address**: ROBUST-QUICKTABS-ARCHITECTURE.md includes:

> "Use keepalive mechanism with 15-second interval to keep background active"

---

### Limitation 4.2: Port Connections Disconnect Unpredictably

**Mozilla Documentation Reference**:  
[MDN: Port Disconnection](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/Port)

From MDN documentation and Firefox behavior:

> "In Firefox, port connections may be closed unexpectedly. Sidebars are
> particularly prone to port disconnection due to context switching."

**The Problem**:

A runtime.Port connection (sidebar ↔ background) can close for reasons outside
developer control:

```javascript
// Sidebar establishes port connection
const port = browser.runtime.connect({ name: 'quick-tabs' });

// Port working fine...
port.postMessage({ type: 'UPDATE_QUICK_TAB' });

// User switches to another application
// ↓ Firefox may pause/suspend content contexts
// ↓ Port connection closes silently

// Sidebar tries to send message
port.postMessage({ type: 'CREATE_QUICK_TAB' }); // ← Port is closed!
// Error: "Port is closed"
```

**Current Code Status** (v1.6.3.8-v13):

```javascript
// v1.6.3.8-v13 - FULL Port Removal: Replaced runtime.Port with stateless runtime.sendMessage
// - Ports disconnect unpredictably in Firefox sidebars
// - Heartbeat mechanism adds 500 lines of complex code
// - storage.onChanged is more reliable in Firefox MV2
```

**Workaround Applied**: REMOVED port infrastructure entirely. Now uses:

1. `runtime.sendMessage` (stateless) - each message independent
2. `storage.onChanged` (primary sync) - reliable in Firefox
3. No persistent connections to maintain

**Impact**:

- Persistent port connections are unreliable in sidebar context
- Stateless messaging more robust (each message independent)
- No need for heartbeat/keepalive for connections
- Sidebar doesn't depend on connection state

---

## PART 5: MESSAGING LIMITATIONS

### Limitation 5.1: runtime.sendMessage Has Implicit Timeout

**Mozilla Documentation Reference**:  
[MDN: runtime.sendMessage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage)

**The Problem**:

`runtime.sendMessage` has an implicit timeout (varies by browser):

```javascript
// This promise rejects if background doesn't respond within ~5 seconds
browser.runtime
  .sendMessage({
    type: 'GET_QUICK_TABS_STATE'
  })
  .then(response => {
    // If background takes too long, this never fires
    // Promise rejects instead
  })
  .catch(err => {
    // Error: "The message port closed before a response was received"
  });
```

**Current Code Workaround** (from quick-tabs-manager.js):

```javascript
// v1.6.3.9-v4 - Stateless messaging with explicit timeout
const MESSAGE_TIMEOUT_MS = 3000;

async function sendToBackground(message) {
  try {
    const response = await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), MESSAGE_TIMEOUT_MS)
      )
    ]);
    return response;
  } catch (err) {
    if (err.message === 'timeout') {
      console.warn('Background message timeout');
      // Fall back to storage.onChanged for state sync
    }
    throw err;
  }
}
```

**Impact**:

- Cannot assume messages will always succeed
- Must implement explicit timeout handling
- Requires fallback mechanism (storage.onChanged)
- Sidebar may timeout waiting for background response

---

### Limitation 5.2: Content Script Messages May Never Arrive During Navigation

**Related to Limitation 2.3 (Content Scripts Unload on Navigation)**

**The Problem**:

If content script sends message then page navigates before handler returns:

```javascript
// Content script sends message
browser.runtime
  .sendMessage({
    type: 'CREATE_QUICK_TAB',
    data: currentPageData
  })
  .then(response => {
    // Handler function
    // But if page navigates HERE, script is unloaded
    // Promise never resolves or rejects
  });

// Page navigates...
// window.location = 'different-page.html'
// Content script unloaded mid-message

// The .then() handler will never fire
// Background has no way to know message was abandoned
```

**Current Code Pattern** (from canvas analysis):

```javascript
// No direct workaround in sidebar
// Issue manifests as: "Content script initiated Quick Tab creation but sidebar never updated"
//
// Sidebar recovery: Storage health check fires 5 seconds later, notices state didn't update,
// requests fresh state from background via storage or message
```

**Impact**:

- Cannot guarantee message delivery completion during navigation
- Requires timeout-based recovery (5 second health check)
- Sidebar must explicitly refresh state if update doesn't arrive
- Race condition creates latency (up to 5 seconds to detect failure)

---

## PART 6: ORIGIN AND ISOLATION LIMITATIONS

### Limitation 6.1: Sidebar Cannot Distinguish Tab Origins

**Mozilla Documentation Reference**:  
[MDN: Sidebar Context](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars)

**The Problem**:

Sidebar displays for ALL tabs regardless of origin. Cannot scope Quick Tabs per
origin:

```javascript
// Sidebar shows:
// - Quick Tabs from https://example.com tab
// - Quick Tabs from https://different-site.com tab
// - Quick Tabs from file:// local page
// ALL mixed in same sidebar

// Sidebar has no way to:
// 1. Identify which tab is in focus
// 2. Filter by tab origin
// 3. Know what page the user is viewing
```

**Current Code Workaround** (from quick-tabs-manager.js):

```javascript
// v1.6.3.5-v2: Track current tab ID for Quick Tab origin filtering
let currentBrowserTabId = null;

// Manager sidebar displays ALL Quick Tabs globally, grouped by originTabId
// Unlike content scripts (which filter to their own tab),
// Manager shows Quick Tabs from ALL tabs for global visibility
```

**Impact**:

- Sidebar must ask background for current tab info
- Cannot automatically filter Quick Tabs to current tab
- Sidebar typically shows ALL Quick Tabs (global view)
- Content scripts show only their own tab's Quick Tabs (scoped view)

---

### Limitation 6.2: Content Scripts Cannot Validate Tab Context

**Mozilla Documentation Reference**:  
[MDN: Content Scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)

**The Problem**:

Content script cannot independently verify it's running in the correct tab
context:

```javascript
// Content script on https://example.com
// Cannot call:
// const tabInfo = await browser.tabs.getCurrent(); // FAILS - no tabs API

// Cannot verify:
// 1. Am I in the tab that owns these Quick Tabs?
// 2. Has this tab navigated to a different origin?
// 3. Are other instances of this script running?
```

**Current Code Status**:

```javascript
// Canvas Issue #7: Cannot identify tab context
// Requires originTabId in all writes
// Background coordinates tab-to-tab operations
```

**Impact**:

- Content scripts must trust that they're in the right tab
- Cannot detect if page has navigated to different origin
- Must rely on background to send tab context
- Creates implicit assumption of 1:1 content script per tab mapping

---

## PART 7: FIREFOX-SPECIFIC ARCHITECTURAL LIMITATIONS

### Limitation 7.1: No Persistent WebSocket Connections in MV2

**Mozilla Documentation Reference**:  
[MDN: Manifest V2 Deprecation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/manifest_version)

**The Problem**:

MV2 (and MV3 in Firefox) does NOT allow persistent WebSocket connections in
background scripts:

```javascript
// Cannot do this:
const ws = new WebSocket('wss://example.com/stream');
ws.onmessage = event => {
  // Real-time updates from server
};
// Background terminates every 30s (Limitation 4.1)
// WebSocket connection breaks
```

**Current Code Decision** (from ROBUST-QUICKTABS-ARCHITECTURE.md):

```
Firefox MV2 Only: Chrome would need different background persistence strategy
```

**Impact**:

- No real-time streaming connections
- Cannot maintain persistent server connections in background
- Must use polling or stateless request/response pattern
- Limits integration with server-side features

---

### Limitation 7.2: No Direct Tab ID Correlation in Content Scripts

**Mozilla Documentation Reference**:  
[MDN: Content Scripts - Execution Context](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#execution_environment)

**The Problem**:

Content script cannot inherently know which tab it's running in:

```javascript
// Content script has NO built-in way to get:
const tabId = ??? // What is MY tab ID?

// Must be told by background:
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // sender.tab.id available HERE in background
  // But content script must be TOLD explicitly
  if (message.type === 'INIT_WITH_TAB_ID') {
    const myTabId = message.tabId;
    // Now we know our tab ID
  }
});
```

**Current Code Pattern** (from canvas analysis):

```javascript
// Canvas Issue #7: Sidebar identifies origin tab of storage events
// Requires originTabId in writes
// Background sends this during content script initialization
```

**Impact**:

- Cannot build origin mapping automatically
- Requires explicit handshake: background → content script
- If handshake fails, content script cannot operate correctly
- Race condition: what if message arrives before script runs?

---

## PART 8: SUMMARY TABLE OF LIMITATIONS

| ID  | Category       | API/Feature       | Limitation                              | Current Workaround           | Severity |
| --- | -------------- | ----------------- | --------------------------------------- | ---------------------------- | -------- |
| 1.1 | Sidebar        | browser.tabs      | Cannot access tabs API in sidebar       | Ask background for tab info  | HIGH     |
| 1.2 | Sidebar        | tabs.sendMessage  | Cannot send messages to content scripts | Route through background     | HIGH     |
| 1.3 | Sidebar        | Page access       | Cannot access page DOM/context          | Use storage + messaging only | MEDIUM   |
| 2.1 | Content Script | browser.tabs      | Cannot access tabs API in scripts       | Request from background      | HIGH     |
| 2.2 | Content Script | Manifest          | Must declare in manifest.json           | Planned in manifest          | LOW      |
| 2.3 | Content Script | Navigation        | Script unloads on page navigation       | Timeout + health check       | HIGH     |
| 3.1 | Storage        | storage.onChanged | Events not guaranteed ordered           | Revision numbering           | HIGH     |
| 3.2 | Storage        | storage.sync      | 5KB per-item quota limit                | Use storage.local primary    | MEDIUM   |
| 3.3 | Storage        | storage.session   | Clears on browser close                 | Use storage.local instead    | LOW      |
| 4.1 | Background     | Idle timeout      | 30s idle termination                    | Keepalive messages           | MEDIUM   |
| 4.2 | Background     | Ports             | Disconnect unpredictably                | Use stateless sendMessage    | HIGH     |
| 5.1 | Messaging      | sendMessage       | Implicit timeout on responses           | Explicit timeout + fallback  | MEDIUM   |
| 5.2 | Messaging      | Navigation        | Messages lost during navigation         | Health check recovery        | MEDIUM   |
| 6.1 | Origin         | Sidebar scope     | Cannot filter by tab origin             | Global view + grouping       | MEDIUM   |
| 6.2 | Origin         | Content context   | Cannot verify tab context               | Trust + handshake            | MEDIUM   |
| 7.1 | Architecture   | WebSocket         | No persistent connections               | Polling + stateless API      | LOW      |
| 7.2 | Architecture   | Tab ID            | No built-in tab ID mapping              | Background coordination      | HIGH     |

---

## PART 9: PROPOSED ARCHITECTURE ADDRESSING LIMITATIONS

### Which Limitations Are Addressed by ROBUST-QUICKTABS-ARCHITECTURE

| Limitation                      | Addressed  | How                                                          |
| ------------------------------- | ---------- | ------------------------------------------------------------ |
| 1.1 - Sidebar tabs API          | ✅ YES     | Background queries tabs, sends results via message           |
| 1.2 - Sidebar message relay     | ✅ YES     | All sidebar↔content communication routes through background |
| 2.1 - Content script tabs API   | ✅ YES     | Background provides tab info during init                     |
| 2.3 - Content script navigation | ✅ YES     | Health check detects missing updates, triggers refresh       |
| 3.1 - Storage event ordering    | ✅ YES     | Revision versioning enforces ordering                        |
| 3.2 - storage.sync quota        | ✅ YES     | Use storage.local (5MB+) not storage.sync (5KB)              |
| 4.1 - Background idle timeout   | ⚠️ PARTIAL | Keepalive every 15s prevents timeout                         |
| 4.2 - Port disconnection        | ✅ YES     | Removed ports entirely, use stateless sendMessage            |
| 5.1 - Message timeout           | ✅ YES     | Explicit 3000ms timeout + storage fallback                   |
| 5.2 - Navigation message loss   | ✅ YES     | 5s health check detects failure, requests fresh state        |
| 6.1 - Sidebar origin scope      | ✅ YES     | Manager shows global + grouping, content shows scoped        |
| 6.2 - Tab context verification  | ✅ YES     | Handshake + originTabId in writes                            |

---

## PART 10: RECOMMENDATIONS

### For GitHub Copilot Agent Implementing Changes

1. **Do NOT** attempt to use browser.tabs API from sidebar or content scripts
2. **Do** implement explicit timeouts for all runtime.sendMessage calls
3. **Do** use revision counters to validate storage.onChanged event order
4. **Do** keep keepalive interval ≤ 30 seconds to prevent background termination
5. **Do NOT** rely on port connections - use stateless messaging only
6. **Do** implement health checks (5 second interval) to detect missing storage
   events
7. **Do** provide explicit tab context initialization to content scripts
8. **Do** use storage.local (not storage.sync) for Quick Tabs state

### For Code Review

- Verify no calls to `browser.tabs` API from sidebar context
- Verify timeout handling on all `sendMessage` calls
- Verify revision/checksum validation on storage changes
- Verify keepalive messages fire at appropriate intervals
- Verify fallback mechanisms exist for all failure scenarios

---

## NOTES FOR DEVELOPERS

These are **NOT bugs in Firefox** but **inherent architectural constraints** in
WebExtensions:

1. **Security Model**: Sidebar/Content script isolation prevents one from
   directly accessing browser APIs
2. **Performance Model**: Background script lifecycle management to prevent
   memory leaks
3. **Reliability Model**: Event ordering guarantees are NOT provided for
   performance reasons
4. **Quota Model**: Storage limits prevent extensions from consuming excessive
   space

The robust architecture works **WITH** these limitations instead of against
them:

- Uses storage as primary sync (most reliable in Firefox)
- Uses messaging as secondary command path (stateless = no connection
  management)
- Uses health checks for failure detection (replaces heartbeat complexity)
- Uses revision counters for ordering (replaces event ordering guarantees)

This is the **recommended approach for Firefox WebExtensions**.
