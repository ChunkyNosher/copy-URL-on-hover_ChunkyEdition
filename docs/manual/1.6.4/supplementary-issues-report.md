# Copy URL on Hover: Supplementary Issues Report - Parts 5-6

**Extension Version:** v1.6.3.11+ | **Date:** December 21, 2025 | **Scope:**
Browser API limitations, cross-browser quirks, message deduplication flaws,
additional port lifecycle issues, and logging gaps discovered during extended
code scanning

---

## Executive Summary

This supplementary diagnostic report documents 15+ additional high and
medium-severity issues discovered during comprehensive scanning of remaining
files and cross-referencing with browser API documentation. These issues
complement the previous 40+ issues documented in Parts 1-4 and focus on: (1)
cross-browser messaging timeout inconsistencies, (2) Firefox-specific BFCache
port disconnection failures, (3) Service Worker persistence and initialization
timing, (4) message deduplication window sizing and cleanup, (5) originTabId
backward compatibility bypass creating validation loopholes, (6) Silent failures
from unhandled promise rejections, and (7) Listener lifecycle management across
event bus implementations. Combined with earlier findings, these create a
comprehensive picture of systemic reliability issues affecting the extension
across all major browsers.

---

## Critical Issues by Category

### Category 1: Cross-Browser Messaging & Timeout Inconsistencies

**Issues:** #48, #49, #50

**Scope Impact:** Indefinite hangs in Firefox, spurious timeouts in Chrome,
handler crashes from unhandled rejections

#### Issue #48: Firefox browser.runtime.sendMessage Has NO Built-in Timeout (Indefinite Hang Risk)

**Problem Summary** Firefox's `browser.runtime.sendMessage()` API lacks a
built-in timeout mechanism. If background script doesn't respond (background
crashed, handler error, queue overflow), the promise hangs indefinitely. Content
script waits forever for response that will never arrive, blocking critical
operations. Chrome's implementation has ~9 second implicit timeout, creating
inconsistent cross-browser behavior.

**Root Cause**

- **File:** `src/content.js` (message sending logic)
- **Location:** Message sending and promise handling (approximately lines
  1800-1900)
- **Issue:** Code pattern relies on promise rejection timeout, but Firefox
  doesn't timeout promises. Content script sends message with custom timeout via
  Promise.race(), but if handler never calls sendResponse() and never throws,
  race never completes. Timeout promise never settles the race.

**Firefox API Specification:**

- No documented timeout for browser.runtime.sendMessage()
- Promise resolves when handler calls sendResponse()
- If handler doesn't respond and doesn't throw, promise hangs
- Only uninstalled extension or tab close terminates hanging promise

**Chrome API Difference:**

- Implicit ~9 second timeout
- Promise rejects with error if no response in 9 seconds
- Consistent timeout across all messages

**Current Implementation Risk:**

- Code sends message with custom Promise.race(messagePromise, timeoutPromise)
- If timeoutPromise fails to settle (logic error), message hangs forever
- Timeout threshold set aggressively (500ms per phase), may fail on slow systems
- No fallback if timeout itself never fires

<scope>
**Modify:**
- `src/content.js` (message timeout handling, error handling)
- Message sending wrapper (add browser detection, conditional timeout strategy)

**Do NOT Modify:**

- Browser WebExtensions API itself
- Handler invocation logic </scope>

**Fix Required** Implement cross-browser message sending wrapper that: (1)
detects Firefox vs Chrome at runtime, (2) enforces explicit timeout with
fallback mechanism, (3) handles timeout as distinct error from handler error,
(4) implements exponential backoff for retryable timeouts, (5) logs all timeout
occurrences with message type and duration. Consider increasing timeout
threshold from 500ms-1500ms to 1s-5s for slow systems, or make timeout adaptive
based on previous successful handshake latency (but RESET on reconnection).

<acceptance_criteria>

- [ ] Firefox messages timeout after configurable threshold (not indefinite
      hang)
- [ ] Chrome maintains ~9s timeout behavior for compatibility
- [ ] Timeout error logged with message action, timestamp, and duration
- [ ] Content script doesn't block on timeout; moves to retry/fallback
- [ ] Manual test (Firefox): Stop background handler, send message → times out
      (not hangs forever)
- [ ] Manual test (Chrome): Stop background handler, send message → times out
      within 10s
- [ ] Adaptive timeout based on connection latency, reset on reconnect
      </acceptance_criteria>

---

#### Issue #49: Handshake Timeout (500ms per Phase, 1500ms Total) Too Aggressive for Slow Systems

**Problem Summary** Port connection handshake expects INIT_REQUEST response
within 500ms per phase (INIT_REQUEST, INIT_RESPONSE, HANDSHAKE_CONFIRM = 1500ms
total). On slow systems, slow network, or background startup delay, legitimate
connections timeout and reconnect repeatedly. This causes connection churn and
poor UX.

**Root Cause**

- **File:** `src/content.js` (handshake timeout constants)
- **Location:** Handshake timeout configuration (approximately line 2050)
- **Issue:** Hardcoded timeout values don't adapt to system/network conditions.
  First successful handshake should inform timeout thresholds for future
  connections, but current code uses stale latency measurement from previous
  connection (Issue #28). Slow background startup during browser launch causes
  initial handshake to timeout spuriously.

**Timeout Constants:**

- Per-phase timeout: 500ms
- Total handshake: 1500ms
- Retry backoff: Likely exponential (not confirmed)
- No adaptive behavior based on measured latency

**Scenario Causing Spurious Timeout:**

1. Browser launches, background initializes (takes 2-3 seconds on slow systems)
2. Content script connects immediately
3. Handshake phase 1 (INIT_REQUEST) → timeout after 500ms
4. Reconnect, phase 1 again → timeout after 500ms
5. After 3 timeouts, assumes background dead
6. Eventually background finishes init, content script reconnects
7. Rapid connection churn in first 10 seconds of browser session

<scope>
**Modify:**
- `src/content.js` (handshake timeout configuration, adaptive timeout logic)

**Do NOT Modify:**

- Handshake protocol itself
- Reconnection strategy </scope>

**Fix Required** Measure actual handshake latency on first successful
connection. Use this as baseline for future timeout thresholds (e.g., timeout =
max(1000ms, baseline \* 3)). Increase default timeout thresholds: 1000ms-2000ms
per phase (2-3s total) for slower systems. Implement exponential backoff for
retries: 1st retry 1s wait, 2nd retry 2s wait, 3rd retry 4s wait. Reset timeout
to measured value on each successful connection.

<acceptance_criteria>

- [ ] First successful handshake duration measured and logged
- [ ] Timeout thresholds adaptive: min 1000ms, scale with measured latency
- [ ] Exponential backoff between retry attempts
- [ ] Manual test: Slow system / slow startup → no spurious timeouts, single
      successful connection
- [ ] Manual test: Normal system → fast connection, timeout thresholds
      reasonable
- [ ] Logging shows handshake latency measurement and timeout threshold
      calculation </acceptance_criteria>

---

#### Issue #50: Service Worker Restart During In-Flight Message Causes Silent Hang

**Problem Summary** Content script sends message to background. Between message
send and handler response, background service worker unloads (Chrome inactivity
timeout ~30s). Service worker restarts, but message event listener registration
lost. New handler not registered, message never gets response. Content script
waits indefinitely (or until custom timeout fires).

**Root Cause**

- **File:** `src/background/MessageRouter.js` (handler registration location)
- **Location:** Message handler registration
- **Issue:** Handlers registered in module initialization code, but if service
  worker restarts, module code re-runs. BUT: If message arrives between unload
  and re-registration, it's dropped. Chrome doesn't queue messages across
  service worker boundaries.

**Chrome Service Worker Lifecycle:**

- Service worker unloads ~30s after last event
- New message causes service worker to restart
- Module initialization re-runs (handlers re-registered)
- BUT: Message that triggered restart arrives before handlers registered
- Result: onMessage listener not registered, message lost

**Current Mitigation Status:**

- Handlers registered at module top-level (good)
- MessageRouter registration happens in module initialization (should be
  automatic)
- No explicit retry mechanism if message arrives during startup
- No notification to content script of service worker restart (separate from
  HEARTBEAT)

<scope>
**Modify:**
- `src/background/index.js` or initialization logic (ensure handlers registered ASAP)
- Message queuing mechanism (queue messages arriving before fully initialized)

**Do NOT Modify:**

- Handler implementations
- MessageRouter core logic </scope>

**Fix Required** Implement message queue for messages arriving before
initialization completes. Store incoming messages in queue, process after
initialization finishes. Alternatively: Register browser.runtime.onMessage
listener at absolute top-level (before any async operations), defer message
processing to router. Use MessageRouter's built-in pre-init queue (already
exists for Issue #20). Verify queue properly drains after initialization
completes.

<acceptance_criteria>

- [ ] Message listener registered before any async initialization
- [ ] Pre-initialization messages queued and processed after init
- [ ] Pre-init message queue drains completely after initialization
- [ ] Manual test: Send message during service worker startup → received and
      processed (not dropped)
- [ ] Logging shows messages queued pre-init and drained post-init
      </acceptance_criteria>

---

### Category 2: Firefox BFCache & Port Lifecycle Edge Cases

**Issues:** #51, #52

**Scope Impact:** Port frozen in BFCache, stale event listeners fire,
reconnection fails silently

#### Issue #51: Firefox BFCache Keeps Port Connected But Frozen (onDisconnect Never Fires)

**Problem Summary** Firefox's BFCache (Back-Forward Cache) preserves page state
when user navigates away, allowing instant restoration when user goes back. When
page enters BFCache, port remains "connected" but messages fail silently. Port
doesn't fire `onDisconnect` event until page is removed from BFCache AND
navigated away again. Content script doesn't know port is frozen, continues
sending messages to disconnected port.

**Root Cause**

- **File:** `src/content.js` (port connection and disconnect handling)
- **Location:** Port lifecycle management, onDisconnect listener
- **Issue:** Code assumes port.onDisconnect fires when port becomes unusable. In
  BFCache, port stays in limbo: connected but non-functional. Messages sent to
  frozen port fail silently (no error, no response). Content script waits
  indefinitely for responses that will never arrive.

**Firefox BFCache Behavior:**

- Page navigated away → enters BFCache (if eligible)
- Port still shows connected status
- port.postMessage() silently fails (no error thrown)
- onDisconnect NOT fired (event not queued)
- Page restored from BFCache → messages work again
- Page navigated away again → onDisconnect finally fires

**Historical Context:**

- Mozilla Bug #1370368: port.onDisconnect not fired on navigation
- Affected Firefox 55+ (BFCache enabled)
- Still affects current Firefox versions

**Current Mitigation Status:**

- No pagehide/pageshow event listeners to detect BFCache entry
- No mechanism to force disconnect when entering BFCache
- No differentiation between "port temporarily frozen" vs "port permanently
  disconnected"

<scope>
**Modify:**
- `src/content.js` (add pagehide/pageshow event listeners)
- Port management logic (explicitly handle BFCache scenarios)

**Do NOT Modify:**

- Port connection protocol
- Handler response logic </scope>

**Fix Required** Add `pagehide` event listener to detect when page enters
BFCache. On pagehide: (1) mark port as "entering BFCache" (frozen but not
disconnected), (2) prevent sending messages to frozen port, (3) queue messages
for retry after pageshow. On `pageshow` event: (1) if port still connected,
resume normal operation, (2) if port disconnected, reconnect. Use pagehide event
to proactively handle BFCache without waiting for onDisconnect to eventually
fire.

<acceptance_criteria>

- [ ] pagehide event listener added, fires when page enters BFCache
- [ ] pageshow event listener added, fires when page restored from BFCache
- [ ] Messages not sent to frozen port (queued instead)
- [ ] Queued messages sent after pageshow (when port functional again)
- [ ] Manual test (Firefox): Navigate away and back → connection resumes, no
      stale messages
- [ ] Manual test: Background restarts while page in BFCache → detected on
      pageshow </acceptance_criteria>

---

#### Issue #52: Stale Event Listeners Fire After Page Restored From BFCache

**Problem Summary** When page enters BFCache, event listeners registered on page
(click handlers, storage listeners, etc.) are preserved in memory. When page
restored from BFCache, listeners re-fire for events that occurred while page was
in BFCache. This causes duplicate event processing, stale state updates, and UI
glitches.

**Root Cause**

- **File:** Event listeners throughout content.js (storage.onChanged, adoption
  listeners, state listeners, etc.)
- **Location:** Event listener registration during page initialization
- **Issue:** Event listeners registered once on page load, never unregistered.
  When page enters BFCache, listeners stay in memory. When page exits BFCache,
  stored events fire, even though they occurred when page was inactive. Code
  doesn't account for "event occurred while I was in BFCache."

**Scenario:**

1. User on Wikipedia, content script registers storage.onChanged listener
2. User navigates to YouTube
3. Wikipedia enters BFCache, listener still active in memory
4. Background modifies storage (new Quick Tab created)
5. storage.onChanged fires on Wikipedia (even though page inactive)
6. Event processed by stale Wikipedia context
7. User navigates back to Wikipedia
8. Stale event fires again (or already processed while in BFCache)
9. UI updates with outdated data

<scope>
**Modify:**
- Event listener registration logic (add cleanup on pagehide)
- Event handler logic (add staleness detection)

**Do NOT Modify:**

- Event types themselves
- Storage schema </scope>

**Fix Required** Add pagehide listener that: (1) unregisters all event listeners
before BFCache, (2) records "page inactive" timestamp. On pageshow: (1)
re-register event listeners, (2) query backend for current state instead of
relying on events that fired while inactive, (3) compare timestamp of received
events against "page inactive" timestamp, reject events older than inactivity
start. Alternative: Use visibilitychange event to detect visibility changes,
ignore events while page hidden.

<acceptance_criteria>

- [ ] Event listeners unregistered on pagehide
- [ ] Event listeners re-registered on pageshow
- [ ] Page inactivity timestamp tracked
- [ ] Events older than inactivity start rejected (staleness check)
- [ ] Manual test: Edit Quick Tab while page in BFCache → changes not applied
      stale
- [ ] Manual test: Return from BFCache → UI reflects current backend state (not
      stale events) </acceptance_criteria>

---

### Category 3: Message Deduplication Flaws & Window Sizing

**Issues:** #53, #54, #55

**Scope Impact:** Legitimate duplicate operations rejected, dedup entries
accumulate per-tab

#### Issue #53: Message Deduplication Window (250ms) Too Small for Double-Click Operations

**Problem Summary** Message deduplication prevents duplicate CREATE_QUICK_TAB
messages sent within 250ms of each other. User double-clicks "Create Quick Tab"
button (legitimate rapid operation). First click processed, second click
(arriving 50-100ms later) rejected as duplicate. User confused: first Quick Tab
created, second click doesn't respond.

**Root Cause**

- **File:** `src/background/handlers/QuickTabHandler.js`
- **Location:** `DEDUP_WINDOW_MS = 250` constant (line ~30)
- **Issue:** Window sized for network/browser duplicate handling, not user
  interaction. Keyboard double-click fires 10-50ms apart (Windows default:
  ~40ms). User quickly pressing Create button twice = legitimate operation, but
  rejected as duplicate.

**Deduplication Intended Purpose:**

- Prevent network/browser double-send of same message
- Protect against background queue processing duplicate from retry
- NOT intended to prevent legitimate rapid operations from same user

**Scenario:**

1. User clicks Create Quick Tab button
2. Message reaches background at T=0ms
3. User clicks again at T=30ms (double-click)
4. Second message reaches background at T=32ms
5. Dedup check: (32 - 0) = 32ms < 250ms → DUPLICATE
6. Second click silently ignored
7. User sees only 1 Quick Tab, expects 2

<scope>
**Modify:**
- `src/background/handlers/QuickTabHandler.js` (dedup window sizing)
- Dedup logic (add operation-specific thresholds)

**Do NOT Modify:**

- Dedup mechanism itself
- Message ID generation </scope>

**Fix Required** Increase dedup window to 1000-2000ms (1-2 seconds) to
accommodate legitimate rapid operations while still filtering network
duplicates. Alternatively: Track dedup by (messageId + messageHash) to
differentiate between identical duplicate vs same operation type with different
parameters. Add logging to measure actual duplicate frequency vs false
positives. Consider making window configurable per message action (HEARTBEAT =
5000ms, CREATE = 2000ms, UPDATE = 500ms).

<acceptance_criteria>

- [ ] Dedup window increased to 1000-2000ms
- [ ] User can create multiple Quick Tabs with rapid clicks (not rejected as
      duplicate)
- [ ] Legitimate duplicates (network retries) still filtered
- [ ] Dedup hit rate logged (actual duplicates vs false positives)
- [ ] Manual test: Click Create twice rapidly → both Quick Tabs created (not
      second rejected)
- [ ] Manual test: Network retry sends same message twice → only one processed
      </acceptance_criteria>

---

#### Issue #54: Dedup Cleanup (5-10 Second TTL) Insufficient for High-Frequency Operations

**Problem Summary** Dedup entries kept for 10 seconds max, cleaned up every 5
seconds. With 100+ rapid CREATE operations per hour in multi-tab scenario, dedup
Map grows per-tab. Cleanup removes old entries, but new entries added faster
than old ones expire. After 24 hours: hundreds of entries per tab × number of
tabs.

**Root Cause**

- **File:** `src/background/handlers/QuickTabHandler.js`
- **Location:** `DEDUP_TTL_MS = 10000`, `DEDUP_CLEANUP_INTERVAL_MS = 5000` (line
  ~40)
- **Issue:** TTL and cleanup interval fixed, don't scale with operation
  frequency. Cleanup happens every 5s, but entries valid for 10s = up to 10s of
  growth unchecked. With 50 operations in 5s window, entries accumulate.

**Memory Accumulation Scenario:**

1. 100 CREATE operations across 10 tabs = 10 operations per tab per hour
2. Each operation creates entry in processedMessages Map
3. Entry expires after 10s (if no more operations within 10s on same tab)
4. But if operations continuous, entry never expires
5. After 24h with high-frequency operations: 10 ops/tab/hr × 24h = 240
   entries/tab
6. Across 20 tabs = 4,800 entries = ~1MB+ memory

<scope>
**Modify:**
- `src/background/handlers/QuickTabHandler.js` (TTL and cleanup interval constants)
- Cleanup logic (make adaptive)

**Do NOT Modify:**

- Dedup mechanism itself
- Message processing </scope>

**Fix Required** Reduce TTL to 3000ms (3 seconds) and cleanup interval to 1000ms
(1 second) for more aggressive cleanup. Alternatively: Use LRU (Least Recently
Used) cache with max size (e.g., 100 entries), evicting oldest when limit
exceeded. Monitor processedMessages.size and log warning if exceeds threshold
(e.g., >500 entries). Make TTL and cleanup interval configurable, scale based on
measured operation frequency.

<acceptance_criteria>

- [ ] TTL reduced to 3000ms (3 seconds)
- [ ] Cleanup interval reduced to 1000ms (1 second)
- [ ] Or: LRU cache with max 100 entries, evict oldest
- [ ] processedMessages.size stays <100 during normal operation
- [ ] Warning logged if Map size exceeds threshold
- [ ] Manual test: 100+ operations → dedup Map size bounded
- [ ] Manual test: 24-hour operation → no memory bloat from dedup
      </acceptance_criteria>

---

#### Issue #55: Dedup Doesn't Account for Parameter Variations (Treats Different Ops as Duplicates)

**Problem Summary** Dedup key is `${action}-${messageId}`. Two CREATE_QUICK_TAB
messages with different parameters (different URL, position, size) but same
messageId arrive within dedup window. Second message rejected as duplicate, even
though it's a different operation.

**Root Cause**

- **File:** `src/background/handlers/QuickTabHandler.js`
- **Location:** `_isDuplicateMessage()` method (line ~100)
- **Issue:** Dedup key only includes action and messageId, not message
  hash/checksum. If two distinct CREATE operations have same ID (bad UUID
  generation or collision), dedup incorrectly rejects second as duplicate.

**Scenario:**

1. User creates Quick Tab 1 at (200, 300)
2. Message: {action: 'CREATE_QUICK_TAB', id: 'qt-1', url:
   'https://a.example.com', left: 200, top: 300}
3. User quickly creates Quick Tab 2 at (400, 500)
4. Message: {action: 'CREATE_QUICK_TAB', id: 'qt-1', url:
   'https://b.example.com', left: 400, top: 500}
5. ID collision or reuse → second message rejected as duplicate
6. Quick Tab 2 never created

<scope>
**Modify:**
- `src/background/handlers/QuickTabHandler.js` (dedup key generation)
- Dedup logic (include message content hash)

**Do NOT Modify:**

- Message ID generation (separate issue)
- Quick Tab creation logic </scope>

**Fix Required** Change dedup key to include message content hash (not just
action + id). Compute hash of JSON.stringify(message) or include specific
parameters (url, position, size) in key. This way, same ID with different
parameters = different dedup key = both operations processed. Update dedup key
pattern: `${action}-${messageId}-${contentHash}`.

<acceptance_criteria>

- [ ] Dedup key includes message content hash or parameter hash
- [ ] Two different CREATE operations with same ID → both processed (not second
      rejected)
- [ ] Network duplicate (identical message) → still deduplicated (detected via
      content hash match)
- [ ] Manual test: Create QT1 and QT2 rapidly → both created (not QT2 rejected)
- [ ] Manual test: Browser retry sends identical message twice → only one
      processed </acceptance_criteria>

---

### Category 4: OriginTabId Validation Bypass & Backward Compatibility

**Issues:** #56, #57

**Scope Impact:** Security bypass allows cross-tab operations, legacy
compatibility creates loopholes

#### Issue #56: originTabId Validation Has Intentional Bypass for Backward Compatibility (Security Risk)

**Problem Summary** QuickTabHandler.\_validateOriginTabId() includes code: "If
payload doesn't have originTabId, use sender.tab.id as default." This backward
compatibility fallback allows old clients (or deliberately crafted messages) to
omit originTabId field and automatically pass validation using sender.tab.id.
New security-focused code shouldn't allow implicit fallback for required fields.

**Root Cause**

- **File:** `src/background/handlers/QuickTabHandler.js`
- **Location:** `_validateOriginTabId()` method (line ~220)
- **Issue:** Code pattern:

```
if (payloadTabId === null || payloadTabId === undefined) {
  return { valid: true, resolvedTabId: senderTabId };  // FALLBACK: use sender.tab.id
}
```

**Intent vs Risk:**

- Intent: Support old content scripts that don't send originTabId
- Risk: New malicious content scripts can intentionally omit field to trigger
  fallback
- Problem: No way to differentiate "old client" from "intentional bypass
  attempt"

**Scenario - Exploitation:**

1. Attacker compromises tab A
2. Wants to RESTORE Quick Tab from tab B
3. Instead of sending ownership validation, omits originTabId field
4. Validation fallback uses sender.tab.id (tab A's ID)
5. If tab B's originTabId happens to match tab A's ID (unlikely but possible in
   tab reuse), succeeds
6. If not, still bypasses the INTENT of ownership check

<scope>
**Modify:**
- `src/background/handlers/QuickTabHandler.js` (remove backward compatibility fallback)
- Client-side message construction (ensure originTabId always sent)

**Do NOT Modify:**

- Overall ownership validation pattern
- Storage schema </scope>

**Fix Required** Remove the fallback: if originTabId missing AND operation
requires ownership, reject with error "Missing originTabId field." For backward
compatibility, instead: (1) bump extension version, (2) auto-update content
scripts, (3) maintain grace period (e.g., 30 days) where missing originTabId
still accepted but logged as legacy. After grace period, reject missing
originTabId entirely. Alternatively: Server-side (background) always populates
originTabId in response (Issue #47 partially covers this), forcing clients to
echo it back.

<acceptance_criteria>

- [ ] originTabId field REQUIRED, no fallback to sender.tab.id
- [ ] Missing originTabId rejected with "MISSING_REQUIRED_FIELD" error
- [ ] All ownership-required operations require explicit originTabId
- [ ] Legacy client handling (optional grace period with logging)
- [ ] Manual test: Send CREATE without originTabId → rejected with error
- [ ] Manual test: Send CLOSE without originTabId → rejected (or allowed with
      warning if grace period) </acceptance_criteria>

---

#### Issue #57: originTabId Not Scoped to Domain (Subdomain Isolation Weak)

**Problem Summary** originTabId validation only checks tab ID, not tab's
domain/URL. Content script from `a.example.com` can RESTORE Quick Tab created on
`b.example.com` if tab IDs happen to match (tab reuse). Browser allows tab reuse
(same tab number across navigations), so subdomain isolation fails.

**Root Cause**

- **File:** `src/background/handlers/QuickTabHandler.js` (validation)
- **Location:** `_validateOriginTabId()` method
- **Issue:** Validation:

```
if (payloadOriginTabId !== senderTabId) { reject }
```

No domain/URL check. Tab IDs are per-browser-session and can be reused. If tab 1
navigates from a.example.com → b.example.com, quick tabs created on
a.example.com have originTabId=1, but new domain is also in tab 1.

**Scenario:**

1. User navigates tab 1 to a.example.com
2. Creates Quick Tab QT-A with originTabId=1
3. User navigates tab 1 to b.example.com (same tab)
4. Creates Quick Tab QT-B with originTabId=1
5. b.example.com content script can now RESTORE QT-A (same tab ID, no domain
   check)
6. QT-A belongs to a.example.com but being manipulated by b.example.com

<scope>
**Modify:**
- `src/background/handlers/QuickTabHandler.js` (add domain validation)
- Quick Tab storage (add originURL or originDomain field)

**Do NOT Modify:**

- Tab ID scheme
- Storage schema (unless backward compat handled) </scope>

**Fix Required** Store originURL or originDomain with each Quick Tab. During
validation, extract domain from sender.tab.url and compare against stored
originDomain. Validation must now check: (1) sender.tab.id === originTabId AND
(2) sender.tab.url domain === originDomain. Implement domain extraction safely:
use `new URL(sender.tab.url).hostname`, compare against
`new URL(storedOriginUrl).hostname`.

<acceptance_criteria>

- [ ] originDomain or originURL stored with Quick Tab
- [ ] Validation checks both tab ID and domain match
- [ ] Different subdomains cannot cross-adopt Quick Tabs
- [ ] Manual test: Create QT on a.example.com, navigate to b.example.com →
      cannot RESTORE QT
- [ ] Manual test: Same subdomain across navigation → can still manage QTs
      </acceptance_criteria>

---

### Category 5: Silent Failures & Unhandled Promise Rejections

**Issues:** #58, #59

**Scope Impact:** Crashes not visible in console, handler errors hidden from
diagnostics

#### Issue #58: Unhandled Promise Rejection in Message Handlers Not Logged (Silent Failure)

**Problem Summary** Message handlers return promises. If handler throws error or
promise rejects, error is caught in MessageRouter.route() try/catch but not
properly propagated. Error logged to console, but content script not notified of
failure. Content script waits indefinitely for response that sender never
provides.

**Root Cause**

- **File:** `src/background/MessageRouter.js`
- **Location:** `_routeToHandler()` method (line ~1200)
- **Issue:** Code pattern:

```
try {
  const result = await handler(message, sender);
  sendResponse(result);
} catch (error) {
  console.error('Handler error:', error);
  sendResponse({ success: false, error: error.message });
}
```

Problem: Handler crashes with unhandled error (e.g., null reference). Promise
rejects. Catch block catches it, logs to console. BUT: If sendResponse not
called (due to bug in error handling path), content script never gets response.

**Scenario:**

1. Handler processes message
2. Null pointer exception: `quickTab.url.split()` where quickTab is undefined
3. Handler throws error
4. Catch block: `sendResponse({ success: false, ... })`
5. BUT: sendResponse might fail if response object too large, contains
   non-serializable data, etc.
6. Content script waits indefinitely

<scope>
**Modify:**
- `src/background/MessageRouter.js` (improve error handling, response format validation)
- Handlers (defensive null/undefined checks)

**Do NOT Modify:**

- Handler registration
- Message routing protocol </scope>

**Fix Required** Ensure sendResponse ALWAYS called in error path, even if error
logging fails. Wrap sendResponse call in try/catch. Log all handler errors with
full stack trace, message action, and content script tab ID. Add response
validation: before sending, verify response is serializable (use
`JSON.stringify()` test), reject if invalid. Implement "dead letter" queue for
messages that fail to send response.

<acceptance_criteria>

- [ ] All handler errors logged to console with full context
- [ ] sendResponse always called in error path (never skipped)
- [ ] Response format validated before sending (serializable, not too large)
- [ ] Content script notified of handler error (doesn't timeout)
- [ ] Manual test: Handler throws error → content script receives error response
      (not timeout)
- [ ] Manual test: Response too large → error logged, content script notified
      </acceptance_criteria>

---

#### Issue #59: Storage.onChanged Listener Fires But Has No Error Path (Failures Hidden)

**Problem Summary** Storage.onChanged event listener registered to handle
storage changes. Listener callback doesn't have error handling. If listener
crashes (exception thrown), error swallowed by browser, no console error shown.
Storage changes silently fail to process.

**Root Cause**

- **File:** Content script initialization (not explicitly in previous scans, but
  common pattern)
- **Location:** Event listener registration for storage changes
- **Issue:** Pattern:

```
browser.storage.onChanged.addListener((changes, areaName) => {
  // Process changes
  // No try/catch around logic
  // If exception thrown, event listener stops processing
});
```

If listener body throws exception, browser's event handling catches it but
doesn't log it conspicuously. Storage changes after error are missed.

<scope>
**Modify:**
- Storage event listener implementations (add error handling)
- Event listeners throughout codebase (add try/catch, logging)

**Do NOT Modify:**

- Storage schema
- Event listener API itself </scope>

**Fix Required** Wrap all event listener callbacks in try/catch blocks. Log all
caught exceptions with listener name, event details, and error message.
Implement error recovery: if storage listener fails, queue the change for retry
instead of silently dropping it. Add centralized event listener error handler
(if browser API supports it).

<acceptance_criteria>

- [ ] All event listeners have try/catch wrapper
- [ ] All errors logged with listener name, event, and error
- [ ] Storage listener failures don't prevent processing subsequent changes
- [ ] Failed changes queued for retry (optional, but preferred)
- [ ] Manual test: Listener throws error → error logged, listener still active
- [ ] Manual test: Subsequent storage changes processed (listener didn't stop)
      </acceptance_criteria>

---

### Category 6: Logging Gaps & Missing Diagnostics

**Issues:** #60, #61, #62, #63

**Scope Impact:** Silent failures indistinguishable from timeouts, no visibility
into state changes

#### Issue #60: Message Rejection Events Not Logged (Malformed Messages Silently Dropped)

**Problem Summary** MessageRouter.\_handleNoHandler() rejects messages with
unknown action. Rejection logged to console, but only with generic "Unknown
action" message. No context about which tab sent it, what URL, or why it's
unknown. Content script assumes message processed successfully (or times out)
without realizing it was rejected.

**Root Cause**

- **File:** `src/background/MessageRouter.js`
- **Location:** `_handleNoHandler()` and validation code (line ~1100)
- **Issue:** Rejection logging minimal:

```
console.warn('[MSG][MessageRouter] No handler for action: ${action}');
```

Missing: sender tab ID, sender frame ID, sender URL, message timestamp,
rejection reason.

<scope>
**Modify:**
- `src/background/MessageRouter.js` (enhance rejection logging)

**Do NOT Modify:**

- Rejection mechanism itself </scope>

**Fix Required** Add structured logging for all message rejections:

- Message action
- Sender tab ID and frame ID
- Sender URL (first 100 chars for privacy)
- Rejection reason (Unknown action, Invalid structure, Ownership mismatch, etc.)
- Timestamp
- Message parameters (if safe to log)

Create diagnostic log entry tracking rejection rate per action to identify
patterns.

<acceptance_criteria>

- [ ] All message rejections logged with context (tab, URL, reason)
- [ ] Rejection rate tracked and logged periodically
- [ ] Malformed message diagnostic entries clear and actionable
- [ ] Manual test: Send unknown action → detailed log entry with all context
- [ ] Manual test: Monitor logs; identify which actions are frequently rejected
      </acceptance_criteria>

---

#### Issue #61: Storage Write Failures Not Logged (Silent Quota Exceeded)

**Problem Summary** Storage.local.set() fails silently if quota exceeded. No
error thrown, no callback. Code can't detect quota exhaustion vs. successful
write. Sidebar doesn't refresh, user doesn't see new Quick Tabs, but no error
message visible.

**Root Cause**

- **File:** `src/background/handlers/QuickTabHandler.js`
- **Location:** `saveStateToStorage()` and `_performStorageWrite()` methods
- **Issue:** Storage write catches DOMException errors, logs them. But if quota
  exceeded silently, no exception thrown. Write appears successful but data not
  persisted.

**Chrome Storage Quota Behavior:**

- Quota exceeded returns Promise that resolves (not rejects)
- No error property on result
- Data not written
- No way to detect failure

<scope>
**Modify:**
- `src/background/handlers/QuickTabHandler.js` (add post-write validation)
- Storage utilities (add quota checks before write)

**Do NOT Modify:**

- Storage API itself </scope>

**Fix Required** After storage write, immediately read back written data from
storage and compare against what was written. If mismatch or missing, log
"STORAGE_WRITE_VERIFICATION_FAILED" error. Before writing large state, check
available quota using `browser.storage.local.getBytesInUse()` and
`browser.storage.local.QUOTA_BYTES`. If approaching limit, implement data
compression or archival (delete old Quick Tabs).

<acceptance_criteria>

- [ ] Post-write verification compares written data vs stored data
- [ ] Quota check before writing (prevents over-quota write attempts)
- [ ] Storage write failure logged with full context
- [ ] Quota exhaustion alert sent to user (UI notification, not just console)
- [ ] Manual test: Fill storage to quota → error logged, user alerted
- [ ] Manual test: Enable storage quota simulation → write failure detected
      </acceptance_criteria>

---

#### Issue #62: Port Disconnect Events Not Logged (Silent Reconnection Churn)

**Problem Summary** When port disconnects and reconnects, onDisconnect and
reconnect events aren't logged. No visibility into connection churn. If browser
is experiencing reconnection loop (disconnects every 5 seconds), user and
developer have no way to see this pattern without monitoring network traffic.

**Root Cause**

- **File:** `src/content.js` (port lifecycle management)
- **Location:** Port disconnect/reconnect handlers
- **Issue:** Port event handlers exist but don't log. Code is silent about
  connection state changes.

<scope>
**Modify:**
- `src/content.js` (add logging to all port events)

**Do NOT Modify:**

- Port management logic </scope>

**Fix Required** Log all port events:

- onDisconnect: log timestamp, reason if available, pending message count
- Reconnection attempt: log attempt number, backoff wait time
- Successful reconnection: log attempt number, latency
- onMessage: log message received (action, size, latency)

Implement diagnostic counter: track reconnection rate, log warning if >3
reconnections in 10 seconds.

<acceptance_criteria>

- [ ] Port disconnect logged with timestamp and pending message count
- [ ] Reconnection attempts logged with backoff duration
- [ ] Successful reconnection logged with latency
- [ ] Reconnection churn detected and logged (>3 in 10s = warning)
- [ ] Manual test: Monitor logs; see all port events clearly
- [ ] Manual test: Force port disconnect → logged immediately
      </acceptance_criteria>

---

#### Issue #63: State Change Events Not Logged (Silent UI State Divergence)

**Problem Summary** When Quick Tab state changes (VISIBLE → MINIMIZED, MINIMIZED
→ DESTROYED), no log entry created. If UI shows Quick Tab but it's actually
DESTROYED in backend, developer can't trace when divergence occurred.

**Root Cause**

- **File:** State machine, minimized-manager, and related state tracking
- **Location:** All state update methods
- **Issue:** State is updated silently without logging state transitions.

<scope>
**Modify:**
- `src/features/quick-tabs/state-machine.js` (log state transitions)
- `src/features/quick-tabs/minimized-manager.js` (log state changes)

**Do NOT Modify:**

- State update logic </scope>

**Fix Required** Log every state change with:

- Quick Tab ID
- Old state
- New state
- Timestamp
- Reason/trigger (user minimized, backend destroyed, etc.)
- Stack trace (to identify caller)

Aggregate logs to detect state divergence patterns.

<acceptance_criteria>

- [ ] All state transitions logged with context
- [ ] State change logs include old and new states
- [ ] Reason for state change captured
- [ ] Manual test: Minimize Quick Tab → logged with timestamp
- [ ] Manual test: Trace state history for any Quick Tab </acceptance_criteria>

---

## Summary Table: Supplementary Issues

| #   | Component                 | Severity | Category            | Fix Complexity |
| --- | ------------------------- | -------- | ------------------- | -------------- |
| 48  | Firefox messaging         | Critical | Cross-browser       | Medium         |
| 49  | Handshake timeout         | High     | Performance         | Low            |
| 50  | Service Worker init       | High     | Port lifecycle      | Low            |
| 51  | BFCache port freeze       | High     | Firefox-specific    | Medium         |
| 52  | BFCache stale listeners   | High     | Firefox-specific    | Medium         |
| 53  | Dedup window size         | Medium   | Message routing     | Low            |
| 54  | Dedup cleanup             | Medium   | Resource management | Low            |
| 55  | Dedup parameter match     | Medium   | Message routing     | Low            |
| 56  | originTabId bypass        | High     | Security            | Low            |
| 57  | Domain isolation weak     | Medium   | Security            | Medium         |
| 58  | Handler error handling    | High     | Error handling      | Low            |
| 59  | Event listener errors     | High     | Error handling      | Low            |
| 60  | Message rejection logging | Medium   | Diagnostics         | Low            |
| 61  | Storage write validation  | High     | Storage             | Medium         |
| 62  | Port event logging        | Medium   | Diagnostics         | Low            |
| 63  | State change logging      | Medium   | Diagnostics         | Low            |

---

## Cross-Cutting Patterns

### Silent Failure Pattern

Multiple locations where operations fail silently without logging:

- Storage quota exceeded (Issue #61)
- Message rejection (Issue #60)
- Port disconnection (Issue #62)
- Event listener exceptions (Issue #59)

**Fix Pattern**: Add comprehensive logging to all failure paths, especially:

- Storage operations
- Network operations
- Event listeners
- Port lifecycle

### Browser API Limitation Pattern

Multiple issues stem from browser API differences:

- Firefox no message timeout (Issue #48)
- Firefox BFCache port freeze (Issue #51)
- Chrome service worker unload (Issue #50)

**Fix Pattern**: Detect browser at runtime, implement browser-specific behavior,
add conditional timeouts/retries.

### Validation Bypass Pattern

Multiple issues allow validation to be bypassed:

- originTabId missing = fallback (Issue #56)
- originTabId missing = use sender tab (security risk)
- Domain not checked (Issue #57)

**Fix Pattern**: Require all validation fields explicitly, no implicit
fallbacks, enforce domain scoping.

---

## Implementation Recommendations

**Phase 1 (Critical - Immediate):**

- Issue #48: Firefox message timeout wrapper
- Issue #56: Remove originTabId fallback bypass
- Issue #58: Error handling in all handlers

**Phase 2 (High - Next):**

- Issue #50: Service Worker initialization queue
- Issue #51: BFCache pagehide/pageshow listeners
- Issue #61: Storage write verification

**Phase 3 (Medium - Following):**

- Issue #49: Adaptive handshake timeout
- Issue #52: Event listener cleanup on BFCache
- Issue #53-55: Dedup window and logic improvements
- Issue #57: Domain isolation in originTabId

**Phase 4 (Diagnostics - Ongoing):**

- Issue #60, #62, #63: Comprehensive logging
- Issue #59: Event listener error handling

---

## Acceptance Criteria Summary

**General Success Metrics (Supplementary Issues):**

- Firefox messages timeout within 5s max (not indefinite hang)
- BFCache navigation doesn't cause port freeze or stale state
- Service worker restart during init doesn't drop messages
- Message deduplication doesn't reject legitimate rapid operations
- No silent storage write failures
- All state changes logged with context
- All event listener errors caught and logged
- Cross-browser consistency (Firefox, Chrome, Edge)

**Estimated Timeline:** 4-7 days implementation (after Phase 1-2 of main issues)

---

**Priority:** Critical (Issues #48, #50, #51, #56, #58) | **Secondary:** High
(Issues #49, #52, #61) | **Total Issues:** 15+ | **Complementary to Parts 1-4
Report**
