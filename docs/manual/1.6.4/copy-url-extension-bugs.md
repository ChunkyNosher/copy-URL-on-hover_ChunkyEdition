---
**Copy URL on Hover Extension - Comprehensive Bug & Missing Logging Report**

**Document Version:** 1.0  
**Date:** December 24, 2025  
**Extension Version Target:** v1.6.3.11-v9 and later  
**Scope:** Startup initialization race conditions, tab ID acquisition, storage persistence failures, and missing diagnostic logging

---

## Executive Summary

The copy-URL-on-hover extension (v1.6.3.11-v9) exhibits three critical initialization failures and widespread missing diagnostic logging that combine to create a complete feature blackout for Quick Tabs:

1. **Tab ID Acquisition Race Condition** - Background script returns `NOT_INITIALIZED` error for all 5+ retry attempts (7.8+ seconds), causing tab identity to remain `null`
2. **Storage Write Blockade** - All storage writes are blocked due to null `currentTabId`, preventing Quick Tab state from persisting to `browser.storage.local`
3. **Missing Diagnostic Logging** - Critical decision points and error conditions lack logging, making root cause analysis difficult

**Root Cause:** The background script is not ready to respond to `GET_CURRENT_TAB_ID` requests during content script initialization, triggering an unrecoverable failure cascade that prevents Quick Tabs from functioning entirely.

**Impact:** Users cannot create, persist, or manage Quick Tabs. Feature is completely non-functional on first load.

---

## Architecture Context

### Quick Tabs Identity Initialization Sequence

```
┌─────────────────────────────────────────────────────────────┐
│ Content Script Initialization (content.js)                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. content.js loads & runs iframe guard                     │
│  2. Module imports complete                                  │
│  3. IDENTITY_INIT SCRIPT_LOAD marker logged ✓               │
│  4. getCurrentTabIdFromBackground() CALLED                   │
│       ├─ Attempt #1: GET_CURRENT_TAB_ID message sent        │
│       │   └─ Response: { error: "NOT_INITIALIZED" } ❌      │
│       │   └─ Retryable: true                                │
│       ├─ Attempt #2-5: Same failures with backoff delays    │
│       │   └─ 200ms, 500ms, 1500ms, 5000ms                  │
│       └─ TOTAL DURATION: 7.8 seconds ⏰                      │
│  5. TabID acquisition FAILS (returns null) ❌               │
│  6. setWritingTabId(null) called with NULL value ⚠️         │
│  7. Quick Tabs manager initialized with currentTabId=null  │
│  8. First Quick Tab created → storage write attempted       │
│  9. Storage write BLOCKED by ownership filter (null check)  │
│       └─ Error: "Storage write BLOCKED - DUAL-BLOCK CHECK   │
│          FAILED... currentTabId is null"                    │
│                                                               │
│  RESULT: No Quick Tabs persist, feature broken              │
└─────────────────────────────────────────────────────────────┘
```

### Background Script Lifecycle Issue

The background script appears to be in an "initializing" state when the content script attempts to acquire the tab ID. Per Mozilla's documentation and observed behavior from logs, background scripts in Manifest V3 can become idle and must be re-activated when needed. However, the extension's messaging protocol does not have sufficient backoff or awareness of background startup timing.

---

## Issue 1: Tab ID Acquisition Fails After Exhausting All Retries

### Severity
🔴 **CRITICAL** - Blocks all Quick Tab functionality

### Root Cause Analysis

**File:** `src/content.js`  
**Location:** `getCurrentTabIdFromBackground()` function (lines ~600-700)  
**Issue:** Background script returns `error: "NOT_INITIALIZED"` for 100% of retry attempts (5 total attempts over 7.8 seconds)

From logs (v1.6.3.11-v9):
```
2025-12-24T224456.761Z WARN ContentTabIDINIT ATTEMPTFAILED attempt 1, error NOTINITIALIZED
2025-12-24T224457.063Z WARN ContentTabIDINIT ATTEMPTFAILED attempt 2, error NOTINITIALIZED
2025-12-24T224457.742Z WARN ContentTabIDINIT ATTEMPTFAILED attempt 3, error NOTINITIALIZED
2025-12-24T224459.255Z WARN ContentTabIDINIT ATTEMPTFAILED attempt 4, error NOTINITIALIZED
2025-12-24T224504.458Z WARN ContentTabIDINIT ATTEMPTFAILED attempt 5, error NOTINITIALIZED
2025-12-24T224504.460Z ERROR IDENTITYINIT TABIDFAILED All retries exhausted
```

### Why This Happens

The background script's `GET_CURRENT_TAB_ID` handler is not initialized or accessible when the content script makes requests during early page load. The background script likely hasn't completed its own initialization (loading config, setting up storage listeners, etc.) before content scripts on multiple tabs begin firing in parallel.

### Architectural Limitation

This is a **fundamental race condition** in the extension architecture:

- Content scripts run **as soon as** the DOM is interactive (milliseconds after page starts loading)
- Background script initialization is **asynchronous** and can take several seconds (loading config, storage access, event setup)
- If content scripts attempt messaging **before** background is ready, requests fail
- Current retry logic maxes out at ~7.8 seconds, but if background initialization takes longer, all retries fail

Per [Mozilla Firefox Bugzilla #1905153](https://bugzilla.mozilla.org/show_bug.cgi?id=1905153), this is a known race condition pattern in Manifest V3 extensions with non-persistent background scripts.

### What Needs to Change

The background script initialization must **guarantee readiness** before content scripts attempt messaging. The current approach of hoping the background is ready by retry #5 is insufficient. Instead:

**Option A (Preferred): Synchronous Background Ready Signal**
The background script should establish a "ready state" that content scripts can poll asynchronously. When background initialization completes, it should fire a `BACKGROUND_READY` message to all connected content scripts. Content scripts should queue all operations until this signal is received.

**Option B: Persistent Port Connection with Queueing**
Establish a persistent port connection from content script to background at script load (not during a request). Queue all `GET_CURRENT_TAB_ID` messages until background fires a handshake response indicating readiness.

**Option C: Increase Retry Backoff & Add Exponential Jitter**
Extend retry delays to 15+ seconds with exponential backoff. However, this is a band-aid that doesn't solve the underlying timing issue—users would experience a 15+ second delay before Quick Tabs become available.

### Missing Logging

- No logging in background script handler when `GET_CURRENT_TAB_ID` request arrives
- No logging showing when background script completes initialization (to pinpoint startup duration)
- No logging showing the "NOT_INITIALIZED" error source or reason
- No correlation between content script retry attempts and background script state changes

---

## Issue 2: Storage Writes Permanently Blocked After Tab ID Acquisition Fails

### Severity
🔴 **CRITICAL** - Makes Quick Tabs non-persistent even if they appear visually

### Root Cause Analysis

**Files:**  
- `src/utils/storage-utils.js` - `persistStateToStorage()` function  
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - `debouncedPersist()` callback  
- `src/features/quick-tabs/handlers/UpdateHandler.js` - `doPersist()` method

**Location:** Storage write ownership validation check  
**Issue:** All storage writes are rejected because `currentWritingTabId` remains null throughout the session

From logs:
```
2025-12-24T224522.718Z WARN StorageUtils Storage write BLOCKED - DUAL-BLOCK CHECK FAILED
  checkFailed: currentTabId is null
  currentWritingTabId is null
  isWritingTabIdInitialized false
  
2025-12-24T224522.718Z ERROR StorageWrite LIFECYCLEFAILURE
  phase: OWNERSHIPFILTER
  reason: Ownership validation failed
```

### The Dual-Block Check

The storage layer has a defensive "dual-block check":

```
if (!currentTabId && !currentWritingTabId) {
  // BLOCKED - "Safety check: cannot persist without tab identity"
}
```

This makes sense for safety (prevents cross-tab data pollution), but it's **permanently triggered** when:

1. `getCurrentTabIdFromBackground()` returns `null` (from Issue #1)
2. `setWritingTabId(null)` is called with the null value (line ~620 in content.js)
3. `currentWritingTabId` remains `null` for entire session
4. Every storage write hits the dual-block check and is rejected

### Cascade Effect

Once tab ID acquisition fails:

1. Quick Tab UI elements render normally (visual only, no persistence)
2. User interacts with Quick Tab (drag, resize, minimize, focus)
3. Event handlers call `persistStateToStorage()`
4. Storage layer checks: `if (isTabIdNull) { BLOCKED_FOR_SAFETY }`
5. Storage write rejected silently with error logs
6. No Quick Tab state saved to `browser.storage.local`
7. Browser reload → no Quick Tabs restore (they were never persisted)

### What Needs to Change

The storage ownership filter needs a **fallback mechanism** when tab ID is unavailable. Currently it's all-or-nothing. Instead:

**Option A: Temporary Storage During Tab ID Initialization**
Use `browser.storage.session` (doesn't persist across browser restart) temporarily while tab ID is acquiring. Once tab ID is established, migrate to `browser.storage.local` with proper ownership. This ensures some persistence within a session.

**Option B: Container-Based Ownership as Fallback**
If tab ID is unavailable, use `originContainerId` (Firefox container) as secondary ownership key. This is weaker than tab ID but prevents most cross-container pollution. Only Quick Tabs created in the same container could be mixed up.

**Option C: Disable Safety Check Only on First Initialization**
Only apply the dual-block check after 10+ seconds have elapsed post-startup. During initial setup, allow writes with `{ unsafeOriginTabId: null, reason: "initialization" }` flag that gets overwritten once real tab ID arrives.

### Missing Logging

- No logging showing **when/why** `isWritingTabIdInitialized` becomes true or stays false
- No logging showing the state of `currentWritingTabId` at each write attempt
- No logging showing how long the system waits before applying ownership filter
- No critical warning that storage writes are permanently blocked system-wide

---

## Issue 3: Missing Initialization Phase Markers and Checkpoints

### Severity
🟡 **MEDIUM** - Makes debugging impossible, root cause analysis difficult

### Root Cause Analysis

**Affected Areas:**
- Background script initialization start/end markers missing
- No logged checkpoint showing when background's `GET_CURRENT_TAB_ID` handler becomes ready
- No timing data on background config loading, storage initialization, event listener setup
- Content script hydration process lacks phase markers
- Storage write decision tree lacks logging at key branches

### Current State vs. Ideal State

**Current logging flow:**

```
[Content] Script loaded ✓
[ConfigManager] Starting load... ✓
[ConfigManager] Storage get completed ✓
[IDENTITY_INIT] TAB_ID_REQUEST ✓
[Content] Attempt #1: GET_CURRENT_TAB_ID [ERROR] ❌
[IDENTITY_INIT] TAB_ID_FAILED [after 7.8s] ✓
[Content] Quick Tabs initialized ✓
[CreateHandler] Creating Quick Tab... ✓
[StorageUtils] Storage write BLOCKED ❌ - reason unclear
```

**Ideal logging would include:**

```
[BACKGROUND_INIT] PHASE_START: Background initialization beginning
[BACKGROUND_INIT] STORAGE_ACCESS: Reading config from browser.storage.local...
[BACKGROUND_INIT] STORAGE_RESULT: Config loaded in XXXms
[BACKGROUND_INIT] EVENT_LISTENERS: Setting up GET_CURRENT_TAB_ID handler
[BACKGROUND_INIT] PHASE_COMPLETE: Background ready after XXXms
                ↓
[CONTENT] GET_CURRENT_TAB_ID request sent (attempt #1)
[BACKGROUND] GET_CURRENT_TAB_ID request received
[BACKGROUND] Responding with tabId: 24
[CONTENT] Tab ID acquired: 24 (attempt #1 success)
```

### Missing Logging Locations

**Background script (`src/background.js`):**
- No marker when handler registration for `GET_CURRENT_TAB_ID` completes
- No marker when `browser.runtime.sendMessage` handler is active
- No logging on message receipt showing message details and response being generated
- No timing data on overall background initialization

**Content script (`src/content.js` - after tab ID acquisition):**
- No logging showing which line of code calls `setWritingTabId()`
- No logging showing the value being passed to `setWritingTabId()`
- No logging showing the state of `isWritingTabIdInitialized()` check at key points
- No explicit logging when storage write ownership filter is triggered

**Storage layer (`src/utils/storage-utils.js`):**
- No logging showing the evaluation of the dual-block check (which conditions are true?)
- No logging showing which ownership filter branch was taken (tab-based vs container-based vs disabled)
- No suggestion/recommendation shown to user when write is blocked
- No timer showing how long until filters might change state

**Event handlers (`VisibilityHandler`, `UpdateHandler`):**
- No logging before calling `persistStateToStorage()`
- No logging showing the reason/trigger for persistence attempt
- No logging showing whether persistence succeeded or failed with actionable next steps

### What Needs to Change

Add comprehensive `[PHASE_NAME] EVENT_TYPE: Description` logging at every major decision point and state transition. Follow pattern already established in logs for `[IDENTITY_INIT]` and `[INIT][Content]` markers.

Specific additions needed:
- Background script ready signal with latency measurement
- Content script → background message request/response pairs with correlation IDs
- Storage write attempt with full context (tab ID, container, reason, outcome)
- Clear error messages suggesting how to resolve the problem

---

## Issue 4: Cross-Origin Iframe Detection & Content Script Re-injection

### Severity
🟡 **MEDIUM** - Defensive mechanism working correctly, but lacks observability

### Root Cause Analysis

**File:** `src/content.js`  
**Location:** `_checkShouldSkipInitialization()` and related iframe guards (lines ~30-60)  
**Issue:** Content script intentionally skips initialization inside Quick Tab iframes, but this makes debugging difficult when trying to understand which context code is running in

### Why This Is Intentional

Quick Tabs display content as iframes. If the content script re-injects into those iframes, it would create:
- Infinite nesting (iframe → content script → creates iframe → content script repeats)
- Multiple Quick Tab managers fighting over the same storage
- Duplicate event listeners and race conditions

The guard correctly prevents this by checking `window.self === window.top` and iframe source patterns.

### Missing Logging in Current Implementation

From logs:
```
[Content] ✓ Content script loaded, starting initialization
[IDENTITY_INIT] SCRIPT_LOAD: Content script loaded...
```

But there's no differentiation logged between:
- Script running in main browser tab (should initialize)
- Script running inside Quick Tab iframe (should skip)
- Script running in cross-origin iframe (should skip)

When a Quick Tab is created and the iframe guard triggers, no contextual logging appears explaining **why** initialization was skipped or in which context the script is running.

### What Needs to Change

The skip conditions already log messages, but the context is missing. Add:

- Log showing `window.self === window.top` result
- Log showing iframe detection results (parent frame class names, data attributes)
- Log showing which guard condition triggered the skip (iframe guard vs cross-origin)
- Log showing `window.CUO_skip_reason` value for debugging
- Log showing whether this is expected (e.g., "Quick Tab iframe") or unexpected (e.g., "Unknown iframe")

This doesn't change functionality but makes it clear when debugging why script ran or didn't run in a particular context.

---

## Issue 5: Tab ID Null Propagates Through All Quick Tab Creation

### Severity
🔴 **CRITICAL** - Data corruption and cross-tab data leakage potential

### Root Cause Analysis

**File:** `src/features/quick-tabs/handlers/CreateHandler.js`  
**Location:** `createQuickTab()` method, originTabId extraction (lines ~150-200)  
**Issue:** When `originTabId` is null, Quick Tabs are created with `{ originTabId: null }`, which breaks tab-scoping entirely

From logs:
```
2025-12-24T224521.596Z WARN QuickTabsManager v1.6.3.10-v10 QUICKTABIDUNKNOWN
  warning: Generating Quick Tab ID with unknown tabId
  currentTabId: null
  
2025-12-24T224521.596Z ERROR CreateHandler WARNING originTabId is nullundefined!
  optionsOriginTabId: null
  defaultsOriginTabId: null
  currentTabId: null
```

### The Cascade

1. Tab ID acquisition fails → `getCurrentTabIdFromBackground()` returns null
2. `setWritingTabId(null)` is called with null
3. Quick Tabs manager initialized with `currentTabId: null`
4. User presses `Q` to create Quick Tab
5. `createQuickTab()` called with no `originTabId` parameter
6. Handler attempts to extract `originTabId` from options → finds null
7. Falls back to `defaultsOriginTabId` → also null
8. Creates Quick Tab with `{ originTabId: null, ...}`
9. When serialized to storage, ownership filter rejects the write
10. BUT if it somehow succeeded, Quick Tab would have `originTabId: null` permanently

### Cross-Tab Data Leakage Risk

If the ownership filter were disabled (or a fallback implemented), Quick Tabs with `originTabId: null` could be:
- Hydrated in **any tab** (null matches any tab)
- Mixed with Quick Tabs from other tabs on the same domain
- Causing Quick Tabs from YouTube tab to appear in Wikipedia tab

This is the **exact scenario Issue #47 described** - Quick Tabs appearing in wrong tabs due to null ownership values.

### What Needs to Change

The `createQuickTab()` method needs to **refuse creation** if `originTabId` is null, rather than allowing null values to propagate. Instead of:

```javascript
const originTabId = options.originTabId ?? defaults.originTabId ?? null; // ❌ Allows null
```

Do:

```javascript
const originTabId = options.originTabId ?? defaults.originTabId;
if (!Number.isInteger(originTabId)) {
  throw new Error('Cannot create Quick Tab without valid originTabId');
}
```

Also add logging showing:
- Attempted creation with null `originTabId`
- Why the tab ID is null (not yet initialized, failed acquisition, etc.)
- Recommendation to wait for tab ID initialization before creating Quick Tabs

---

## Issue 6: Port Connection Lifecycle Events Missing Correlation

### Severity
🟡 **MEDIUM** - Debugging difficult, race conditions hard to diagnose

### Root Cause Analysis

**File:** `src/content.js`  
**Location:** `connectContentToBackground()` and `_handleReconnection()` (lines ~800-900)  
**Issue:** Port connection events (open, disconnect, error) are logged but lack correlation with what messages are queued/sent through that port

From logs:
```
2025-12-24T224520.596Z LOG Content TABACTIVATEDHANDLER Processing tab activation
  receivedTabId: 24
  currentTabId: null  ← Tab ID still null here
  hasQuickTabsManager: true
  
[No corresponding port connection event]
```

### Missing Event Correlation

When port lifecycle events occur (connect, disconnect, message), the logs don't show:
- What messages are in the queue at that moment
- What messages failed to send due to port disconnection
- Whether reconnection succeeded in flushing queued messages
- Timing correlation between when background restarts and when content script reconnects

### What Needs to Change

Add structured correlation IDs to port lifecycle events:

- Assign each content script instance a unique `sessionId` on initialization
- Tag all port events with this `sessionId`
- When port connects, log the count of queued messages and time since session start
- When port disconnects, log pending operation status
- When message fails, show reason and whether it was queued for retry
- When message queue drains, log success count and average delay

---

## Issue 7: Background Handshake Readiness Signal Not Properly Initialized

### Severity
🟡 **MEDIUM** - Communication protocol incomplete

### Root Cause Analysis

**File:** `src/content.js`  
**Location:** `_handleBackgroundHandshake()` (lines ~900-950)  
**Issue:** Background sends `BACKGROUND_HANDSHAKE` message with `isReadyForCommands` field, but content script doesn't know if background is truly ready for `GET_CURRENT_TAB_ID` requests

From logs:
```
No BACKGROUND_HANDSHAKE messages appear in logs at all ❌
No indication of isReadyForCommands state change
```

The handshake mechanism exists in code but doesn't appear to be firing during the initialization sequence. This means the content script has no signal that the background is ready before attempting tab ID acquisition.

### What Needs to Change

The background script needs to send an immediate `BACKGROUND_HANDSHAKE` message when the port connection is established, indicating:
- Whether background initialization is complete
- How long background took to initialize (latency measurement)
- Port ID for correlation

Content script should wait for this handshake before attempting `GET_CURRENT_TAB_ID`, rather than trying immediately. This establishes a reliable "hello" exchange that guarantees both sides are awake.

---

## Firefox API Limitations & Design Constraints

### Background Script Non-Persistence (Manifest V3)

Per [Mozilla documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts), background scripts in Manifest V3 are not persistent by default. They unload when idle, requiring re-activation via:

- `browser.tabs.onCreated` / `onUpdated`
- `browser.runtime.onMessage` (not reliable for wake-up)
- Other lifecycle events

**Implication:** Content scripts attempting to message background during page load may find it uninitialized. No browser-level mechanism waits for background to be ready before allowing content script messaging.

### Tab ID Inaccessibility in Content Scripts

Per [Mozilla documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts), content scripts cannot directly call `browser.tabs.getCurrent()`. This API is only available in background scripts, which is why the extension must message background for tab ID.

**Implication:** Tab ID must be acquired via async messaging. If background isn't ready, there's no local fallback.

### Storage API Synchronization

Per [Mozilla documentation on storage.onChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged), the `onChanged` listener only fires when actual `storage.local.set()` calls complete. Listening to local state changes without persisting won't trigger the event.

**Implication:** If storage write is blocked, no change event fires, so Manager UI won't update. This is why ownership filter blockade is fatal to Quick Tabs functionality.

---

## Summary Table: Issues & Missing Logging

| Issue | Severity | Root Cause | Missing Logging |
|-------|----------|-----------|-----------------|
| Tab ID Acquisition Fails | 🔴 CRITICAL | Background not ready during content script init | Background init phase timing, handler ready status |
| Storage Writes Blocked | 🔴 CRITICAL | Dual-block check fails when tabId=null | Decision tree at each ownership filter evaluation |
| Missing Init Markers | 🟡 MEDIUM | Incomplete logging at phase boundaries | Background ready signal, port handshake status |
| Iframe Re-Injection | 🟡 MEDIUM | Content script context confusion | Guard condition results, iframe detection details |
| TabId Null Propagation | 🔴 CRITICAL | No validation on Quick Tab creation | Null value detection, creation refusal logging |
| Port Correlation | 🟡 MEDIUM | Disconnected lifecycle events | Session IDs, message queue status, port events |
| Background Handshake | 🟡 MEDIUM | Incomplete initialization protocol | Handshake timing, readiness state transitions |

---

## Testing Strategy for Root Cause Verification

To confirm these root causes during testing:

### Test 1: Background Initialization Timing
- Add timestamps to background script `onMessage` listener setup
- Log when `GET_CURRENT_TAB_ID` handler becomes active
- Compare with content script request time → should see 1-3 second gap

### Test 2: Port Connection Establishment
- Add unique correlation ID to each content script instance
- Log all port.postMessage calls with pending message queue size
- Verify handshake completes before tab ID requests

### Test 3: Tab ID Null Value Propagation
- Temporarily disable dual-block check and allow writes with null tabId
- Verify that Quick Tabs with null originTabId appear in multiple tabs
- Restore block and verify writes are rejected

### Test 4: Storage Write Cascade Failure
- Add checkpoints in `persistStateToStorage()` showing each decision
- Log the exact boolean condition that triggered the block
- Verify ownership filter decision is deterministic and repeatable

---

## References

- [Mozilla Bug #1905153: Race condition in extension API startup](https://bugzilla.mozilla.org/show_bug.cgi?id=1905153)
- [Mozilla WebExtension Content Scripts Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)
- [Mozilla WebExtension Background Scripts Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts)
- [Mozilla runtime.sendMessage API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage)
- [Mozilla storage.onChanged Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged)

---

**Notes for Copilot Coding Agent:**

When implementing fixes:

1. **Do NOT** provide exact code changes in this report. Instead, diagnostic work has identified problematic architectural patterns.

2. **Prioritize architectural fixes** over band-aid solutions:
   - Tab ID race condition needs persistent port + handshake protocol, not longer timeouts
   - Storage writes need fallback ownership mechanism, not just disabling the check
   - Logging needs systematic phase markers, not scattered log statements

3. **Follow patterns already in codebase:**
   - Use `[PHASE_NAME] EVENT_TYPE: Description` log format (already established for `[IDENTITY_INIT]`)
   - Use correlation IDs for message tracing (port connection example exists)
   - Use structured error objects with `{ code, reason, suggestion }` (already in storage-utils.js)

4. **Ensure backward compatibility:**
   - Quick Tabs with null `originTabId` may already exist in user storage from broken versions
   - Fallback ownership mechanism must gracefully handle legacy data

5. **Test race conditions:**
   - Content script initialization must not depend on background ready before content can start
   - But storage writes must wait for background readiness before attempting persistence
   - There's a narrow window where UI can exist but state can't persist—this is intentional during init phase
