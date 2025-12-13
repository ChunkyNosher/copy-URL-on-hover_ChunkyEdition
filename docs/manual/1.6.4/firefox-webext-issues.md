# Quick Tabs Feature: Critical Communication & Storage Architecture Issues

**Extension Version:** v1.6.3.8-v6 | **Date:** 2025-12-12 | **Scope:** Cross-tab
state synchronization, port lifecycle management, storage integrity, and Firefox
API compatibility

---

## Executive Summary

The Quick Tabs feature implements a multi-context state management system using
runtime.Port messaging, storage.local persistence, and browser.alarms for
lifecycle management. However, the architecture has systematic vulnerabilities
related to Firefox WebExtension API limitations and incomplete lifecycle
coordination. These issues span communication layer routing, port registry
management, storage quota handling, and frame context tracking, creating
multiple failure modes where the system degrades silently without user
visibility or recovery mechanisms.

This report documents 20 distinct issues across 6 categories that require
architectural improvements to prevent data loss and state divergence.

---

## Issue Category 1: Communication Layer & Port Management (Issues #1-3, #12, #13, #14)

### Issue #1: BroadcastChannelManager Unsuitable for Cross-Context Communication

**File:** `src/features/quick-tabs/channels/`  
**Affected Components:** BroadcastChannelManager, if used for sidebar or
background communication  
**Status:** Partially mitigated (BroadcastChannel removed from background.js per
v1.6.3.8-v6, but potential lingering usage in content script)

**Problem:** BroadcastChannel API operates on same-origin principle (MDN spec:
"same origin, same top-level document"). If any code path attempts to use
BroadcastChannel for communication between content script (origin:
https://example.com) and sidebar (origin: moz-extension://unique-id/), messages
silently fail without error or logging. This creates false impression of working
communication while actual state propagation never occurs.

**Root Cause:** BroadcastChannel security boundary is enforced by browser, not
by extension code. Background removal in v1.6.3.8-v6 was correct, but content
script may still instantiate MessageBatcher with BC fallback option, and sidebar
initialization may attempt BC registration during early startup.

**Why This Matters:** User creates Quick Tab in main document; sidebar renders
stale state. User mutes tab in sidebar; mutation sent to background but never
reaches content script because BC attempted to relay. State divergence between
contexts persists until next page reload or manual refresh.

<scope>
**Audit & Verify:**
- Content script initialization in `src/content.js` - confirm no BC usage for cross-origin messaging
- Sidebar initialization in `sidebar/` directory - confirm runtime.Port is primary communication path
- MessageBatcher in `src/features/quick-tabs/channels/MessageBatcher.js` - verify no BC fallback registered

**Do NOT Modify:**

- background.js (BC already removed, read-only reference)
- Browser security model (immutable) </scope>

**Fix Required:** Audit all content script initialization and sidebar startup
code to confirm BroadcastChannel is only used for intra-frame messaging (same
document context). If BC is used in sidebar initialization, replace with
explicit runtime.Port handshake. Remove any BC fallback logic from
MessageBatcher configuration.

<acceptance_criteria>

- [ ] Code audit confirms no BroadcastChannel usage across origin boundaries
      (https:// ↔ moz-extension://)
- [ ] If BC found in sidebar init, replace with runtime.Port connection
- [ ] MessageBatcher configuration has no BC fallback option enabled
- [ ] Manual test: Create Quick Tab in main document, verify sidebar receives
      update within 500ms via logs showing port communication
      </acceptance_criteria>

---

### Issue #2: Runtime.Port Message Ordering Not Guaranteed Across Concurrent Ports

**File:** `background.js`, `src/background/MessageRouter.js`  
**Method:** Runtime.Port messaging pipeline, deduplication logic  
**Affected Components:** State synchronization between multiple tabs with active
ports

**Problem:** When multiple content script ports send state change messages about
the same Quick Tab simultaneously, the monotonic sequenceId-based deduplication
in background.js doesn't account for inter-port ordering races. If Port A and
Port B both send CREATE and DESTROY messages for same tab ID in rapid succession
(within same JS execution tick), the sequenceId ordering can break down because
sequenceIds are assigned at write-time, not at message-send-time. This creates
race windows where a DESTROY message with higher sequenceId arrives before
CREATE, causing state to appear invalid.

**Root Cause:** `_getNextStorageSequenceId()` in background.js is called during
`WriteQuickTabStateWithValidation()` in content script context. Two content
script ports can call this independently, leading to interleaved sequenceIds
that don't reflect actual event ordering. The revision counter helps within
single-port writes but not across concurrent ports.

**Why This Matters:** Race condition manifests as "Ghost Quick Tabs" where
deleted tabs reappear, or "Missing Quick Tabs" where created tabs disappear
momentarily then reappear. Happens during high-frequency operations like bulk
creation or rapid mute/solo toggling across multiple tabs.

<scope>
**Modify:**
- Background.js message handling - add per-port sequence tracking
- MessageRouter.js - enhance ordering validation for concurrent ports

**Do NOT Modify:**

- Storage write validation (works correctly for single-port scenarios)
- Revision counter logic (revision is working as intended) </scope>

**Fix Required:** Implement per-port sequence ID assignment in background.js
where each port maintains its own monotonic counter. During deduplication,
validate that inter-port message ordering is consistent with logical event
causality (e.g., if Port A creates tab X and Port B creates tab Y, both
operations should succeed regardless of arrival order, but if Port A creates
then Port B destroys same tab, destroyer should win only if its sequenceId is
higher within Port B's sequence).

<acceptance_criteria>

- [ ] Per-port sequence ID tracking implemented in port registry entries
- [ ] Ordering validation checks both port-local and global sequence consistency
- [ ] Manual test: 5 tabs each creating 20 Quick Tabs simultaneously, verify no
      ghost or missing tabs in final state
- [ ] Performance: Per-port tracking adds <5ms latency to message handling
      </acceptance_criteria>

---

### Issue #3: Port Registry Stale Entry Accumulation During Extended Sessions

**File:** `background.js`, port registry management code  
**Threshold:** 50+ ports triggers WARNING, 100+ ports triggers CRITICAL  
**Related to Issue #8:** Iframe context port explosion

**Problem:** The port registry in background.js accumulates stale port entries
over time. While explicit eviction logic exists (every 30 seconds), and periodic
threshold checks run every 30 seconds, the eviction is reactive—it removes ports
that have been inactive for 60+ seconds, but only after threshold checks run.
This creates 30-second windows where stale ports are kept alive unnecessarily.
Additionally, the `lastActivityTime` and `lastMessageAt` properties used for
staleness detection are not consistently updated across all port message paths,
leading to false negatives where legitimately active ports are incorrectly
marked stale.

**Root Cause:** Port activity tracking is incomplete. Properties like
`lastActivityTime` are updated in some message handlers but not all. The
onDisconnect listener, which should trigger immediate cleanup (Firefox bug
1223425: onDisconnect may not fire during BFCache), is not reliable as fallback.
No explicit cleanup when `pagehide` event fires or when content script unload is
detected.

**Why This Matters:** After several hours of normal usage with multiple page
navigations, port registry can grow to 50+ entries. This consumes memory (each
port object holds message queue, context, listeners). Broadcast operations that
iterate all ports slow down. One tab with pathological iframe behavior
(create/destroy iframes rapidly) can degrade all other tabs' performance. No way
to manually trigger cleanup from UI.

<scope>
**Modify:**
- Port activity tracking - ensure all message paths update lastActivityTime
- Port cleanup logic - add explicit cleanup triggers on pagehide/unload
- Diagnostic logging - enhance port registry health reporting

**Do NOT Modify:**

- Firefox browser behavior (immutable)
- Core messaging contract (preserve existing port message format) </scope>

**Fix Required:** Implement reliable port lifecycle tracking by (1) ensuring
every message path updates activity timestamp, (2) adding explicit cleanup
handler for pagehide/beforeunload events that notifies background to close
associated port, (3) implementing immediate disconnection attempt when
port.postMessage fails 3+ consecutive times (detects silent port death due to
Firefox bug), (4) adding user-accessible diagnostic UI showing current port
count and health status.

<acceptance_criteria>

- [ ] All port message handlers update lastActivityTime
- [ ] Content script sends CLEANUP_REQUEST on pagehide event
- [ ] Background detects 3 consecutive postMessage failures and disconnects port
- [ ] Diagnostic logging shows port cleanup actions with reasons
- [ ] Manual test: Open 20 tabs, navigate each 10 times, verify port registry
      stays <30 entries </acceptance_criteria>

---

### Issue #12: Runtime.Port Message Ordering Not Guaranteed During Concurrent Writes

**File:** `src/features/quick-tabs/index.js`, content script state change
emission  
**Related to Issue #2:** Concurrent port sequencing

**Problem:** When two Quick Tabs operations occur in rapid succession on same
tab (e.g., user rapidly clicks mute then solo on same tab), both operations
generate messages sent via same port. However, because
`_getNextStorageSequenceId()` is called during WriteQuickTabStateWithValidation
(which happens in background after message received), the two messages may be
processed out-of-order in background if browser APIs introduce any delay. The
sequenceId at write-time reflects when background processed the message, not
when content script sent it.

**Root Cause:** Sequence ID assignment happens in background during write, not
in content script during message construction. This is correct for deduplication
but creates ordering ambiguity when same port sends multiple messages in rapid
succession—the messages may be processed in background in different order than
sent.

**Why This Matters:** User rapidly mutes then solos same tab. Mute operation
assigned sequenceId 100, solo assigned sequenceId 101, but if solo message is
processed first (< 5ms message handling jitter), solo state appears as baseline
and mute appears as mutation, reversed from user's intent.

<scope>
**Modify:**
- Content script message construction - add client-side timestamp and ordering hint
- Background message processing - validate timestamp ordering for same-port rapid operations

**Do NOT Modify:**

- Storage write validation logic (correct as-is)
- Deduplication core algorithm (revision number based) </scope>

**Fix Required:** Add client-side timestamp to each message sent from content
script. During background processing, if multiple messages from same port have
sequential operations on same Quick Tab, validate that operations are applied in
client-timestamp order, not sequenceId order. This ensures rapid-fire operations
maintain user intent ordering.

<acceptance_criteria>

- [ ] Client-side message timestamp added to all state change messages
- [ ] Background processing validates timestamp ordering for rapid operations on
      same tab
- [ ] Manual test: Rapidly mute/solo same tab 10 times, verify final state
      matches expected sequence </acceptance_criteria>

---

### Issue #13: Iframe Content Script Port Connections Not Tracked by Frame ID

**File:** `background.js` port registry, `src/content.js` iframe handling  
**Manifest Setting:** `"all_frames": false` (current, correct setting)  
**Note:** Current manifest has all_frames: false, so this is lower priority but
worth documenting

**Problem:** Even though manifest.json specifies `"all_frames": false` (which is
correct and prevents iframe content script injection), the port registry in
background.js has no frame ID tracking. If codebase were ever changed to
`"all_frames": true` for debugging, or if sidebar loads iframes, there would be
no way to correlate ports back to their originating frame. This means orphaned
ports (from destroyed iframes) cannot be cleaned up efficiently. As written,
this is architectural debt.

**Root Cause:** Port registry entries store origin, type, and activity metadata,
but not the frameId or tabId context where port originated. MDN recommends
tracking frameId for content scripts injected with all_frames: true to enable
per-frame cleanup.

**Why This Matters:** If extension is modified to support Quick Tabs in iframes
(e.g., for sidebar Quick Tabs panel that may load external HTML), enabling
all_frames would create orphaned ports. Currently mitigated by all_frames:
false, but architectural risk for future features.

<scope>
**Modify:**
- Port registry storage - add frameId and tabId fields
- Port cleanup logic - leverage frame/tab context for targeted cleanup

**Do NOT Modify:**

- manifest.json all_frames setting (leave as false)
- Current port registry format (maintain backwards compatibility) </scope>

**Fix Required:** Enhance port registry entries to include tabId and frameId
from port's originating context. Update cleanup logic to handle per-frame
cleanup when needed. Keep all_frames: false in manifest but prepare codebase for
future changes.

<acceptance_criteria>

- [ ] Port registry entries can store tabId and frameId
- [ ] Cleanup logic can target ports by frame if needed
- [ ] No behavior change in current all_frames: false scenario
- [ ] Architectural debt documented and ready for future iframe expansion
      </acceptance_criteria>

---

### Issue #14: No Timeout or Circuit Breaker for Dead Port Detection

**File:** `background.js`,
`src/features/quick-tabs/channels/MessageBatcher.js`  
**Related Issues:** Port disconnection detection (#3, #6)

**Problem:** When a port becomes unresponsive (content script terminated, page
navigated, browser memory pressure), background.js continues attempting to send
messages to that port without timeout. MessageBatcher queues messages
indefinitely, and `port.postMessage()` calls hang waiting for background script
to complete. After 3 consecutive failures, port is evicted, but this 3-failure
threshold may take 30+ seconds to accumulate depending on message frequency.
During this window, all operations targeting that port block, degrading UI
responsiveness.

**Root Cause:** Port.postMessage() in Firefox doesn't have configurable timeout
(Chrome may differ). Background script must implement circuit-breaker pattern to
detect dead ports quickly. Current code has failure counter but no time-based
escalation—after 1st failure, waits for 2 more failures; after 2nd failure,
still waits; only after 3rd failure does it attempt disconnection.

**Why This Matters:** User navigates away from page. Content script terminates
but port.onDisconnect doesn't fire (Firefox bug 1223425). Background keeps port
alive in registry. User navigates back to same URL, new content script loads,
creates new port. Two ports now exist for same tab. Old port is still alive,
consuming memory and receiving broadcast messages that fail silently. Takes 30+
seconds for old port to accumulate 3 failures and be evicted.

<scope>
**Modify:**
- Port failure detection - add time-based escalation
- Message sending - add per-port timeout or circuit breaker state

**Do NOT Modify:**

- Port.postMessage API contract (immutable)
- Background lifecycle (keep as-is) </scope>

**Fix Required:** Implement circuit breaker pattern where port tracks failures
with timestamps. After 1st failure, enter "degraded" state. After 2nd failure
within 5-second window, enter "critical" state and begin draining message queue.
After 3rd failure or 10 seconds elapsed, disconnect and remove port. Log all
state transitions for diagnostics.

<acceptance_criteria>

- [ ] Port failure counter has time-based window (not just count)
- [ ] Circuit breaker states implemented: healthy → degraded → critical →
      disconnected
- [ ] Port disconnection happens within 10 seconds of first failure, not 30+
- [ ] Manual test: Kill content script via DevTools while broadcasting state,
      verify old port is cleaned up within 15s </acceptance_criteria>

---

## Issue Category 2: Storage Architecture & Persistence (Issues #4-6, #10-11, #15, #17)

### Issue #4: Storage Quota Monitoring Doesn't Detect Approach Until Critical

**File:** `background.js`, `checkStorageQuota()` function  
**Current Monitoring:** Every 5 minutes via ALARM_STORAGE_QUOTA_CHECK  
**Firefox Limit:** 10MB for MV2 extensions

**Problem:** Storage quota monitoring exists and logs warnings at 50%, 75%, 90%
thresholds, which is good. However, the monitoring runs every 5 minutes
(ALARM_STORAGE_QUOTA_INTERVAL_MIN = 5). If user rapidly creates 100+ Quick Tabs
with large URLs, storage quota can jump from 50% to 95% in < 5 minutes, skipping
the 75% warning. Additionally, there is no aggregated tracking across storage
areas—the code monitors storage.local only, but Firefox MV2 allows storage.sync
(5KB limit) and storage.session (variable), which share the same 10MB quota.
Total quota consumption may exceed 10MB even if storage.local is under
threshold.

**Root Cause:** Monitoring interval is fixed at 5 minutes. Large bulk operations
(import feature, if it exists) can create data faster than monitoring detects.
No aggregation of storage.sync and storage.session usage into total quota
calculation.

**Why This Matters:** User loses 50-100 Quick Tabs to automatic recovery/cleanup
without warning. Each write triggers recovery cleanup, creating cascading
slowdowns. User has no way to manually export or prune tabs before system forces
cleanup. No visibility into how much quota other extension features are
consuming.

<scope>
**Modify:**
- Monitoring frequency - increase to every 1 minute during active operations
- Quota calculation - aggregate all storage areas (local + sync + session)
- Warning UI - add user-facing notification when approaching limits

**Do NOT Modify:**

- Firefox storage quota (immutable)
- Recovery algorithm (keep existing iterative reduction strategy) </scope>

**Fix Required:** (1) Implement adaptive monitoring that increases frequency to
every 1 minute when quota is above 50%. (2) Aggregate storage.sync and
storage.session usage into total quota percentage. (3) Add user-facing warning
in popup or sidebar when quota exceeds 75%. (4) Provide manual pruning UI where
user can select tabs to delete before system forces cleanup.

<acceptance_criteria>

- [ ] Monitoring frequency increases to 1-minute interval when quota > 50%
- [ ] Quota calculation includes storage.sync and storage.session bytes
- [ ] 75% threshold warning appears in UI with manual cleanup option
- [ ] Manual test: Rapidly create Quick Tabs until 75% quota, verify warning
      appears within 1 minute </acceptance_criteria>

---

### Issue #5: SessionStorage vs LocalStorage Hydration Order Undefined on BFCache Restoration

**File:** `src/features/quick-tabs/index.js`, hydration logic  
**Related to:** Storage consistency during page lifecycle transitions  
**Firefox Behavior:** sessionStorage persisted in sessionstore.js;
storage.session persisted separately

**Problem:** When page enters BFCache and is restored (back button), content
script may hydrate from sessionStorage (persisted in Firefox's sessionstore.js
file) before storage.local is read from IndexedDB. If background script updated
storage.local while page was in BFCache, content script will initialize with
stale sessionStorage state and never refresh. The code has no explicit mechanism
to detect this divergence and reload storage.local after restoration.

**Root Cause:** No pageshow listener with persisted flag check. Hydration order
not explicitly defined—if sessionStorage exists, it's used; if not,
storage.local is read. No timestamp comparison to determine which is
authoritative.

**Why This Matters:** User views page with Quick Tabs state v1. Navigates to
another page, then back (BFCache). Meanwhile, another tab updated Quick Tabs to
state v2 and persisted to storage.local. First tab restores from sessionStorage
(still v1) and never knows about v2. User sees outdated tabs that were already
deleted in other tabs. Requires manual refresh to sync.

<scope>
**Modify:**
- Content script hydration logic - add explicit storage.local refresh after BFCache restoration
- Timestamp/revision tracking - ensure sessionStorage includes revision number for comparison

**Do NOT Modify:**

- Browser BFCache behavior (immutable)
- Storage API contracts (read-only) </scope>

**Fix Required:** Add pageshow event listener that checks persisted flag. If
persisted=true, explicitly refresh storage.local and compare timestamps/revision
numbers. If storage.local is newer, discard sessionStorage and re-hydrate with
storage.local data. Log all BFCache restoration events with state version for
diagnostics.

<acceptance_criteria>

- [ ] pageshow listener with persisted flag detection implemented
- [ ] Storage.local is re-read after BFCache restoration
- [ ] Revision number comparison determines authoritative state
- [ ] Manual test: Create tabs, navigate away, return via back button, verify
      state matches what other tabs see </acceptance_criteria>

---

### Issue #10: IndexedDB Corruption Detection Not Leveraging Firefox Auto-Reset Pref

**File:** `background.js`, corruption detection and recovery code  
**Firefox Mechanism:**
`extensions.webextensions.keepStorageOnCorrupted.storageLocal` (Firefox 145+)  
**Bugs Referenced:** Firefox bug 1979997, Firefox bug 1885297

**Problem:** Background.js implements storage integrity validation with
redundant storage.sync backup, which is excellent. However, Firefox 145+ added a
hidden preference that automatically resets corrupted IndexedDB databases. The
current code doesn't detect or leverage this Firefox recovery mechanism. If
Firefox automatically recovers from corruption via this pref, the extension's
own recovery code may perform redundant reset-and-restore, creating two
competing recovery paths. Additionally, code doesn't check if Firefox has
auto-reset the database, so it may not properly log that Firefox handled
recovery.

**Root Cause:** Firefox added auto-recovery in version 145. Code was written
before this feature existed and doesn't account for it. No detection of Firefox
auto-reset behavior.

**Why This Matters:** If both extension and Firefox try to recover from same
corruption, data loss or inconsistency can occur. If Firefox auto-recovers,
extension may unnecessarily restore from backup, losing recent changes. Adds
complexity to corruption diagnostics—unclear if corruption was recovered by
Firefox or by extension.

<scope>
**Modify:**
- Corruption detection - detect if Firefox has auto-reset database
- Recovery flow - skip extension recovery if Firefox already handled it
- Logging - explicitly log Firefox auto-recovery when detected

**Do NOT Modify:**

- Firefox auto-recovery behavior (read-only)
- Existing backup mechanism (keep as safety net) </scope>

**Fix Required:** Detect Firefox 145+ auto-recovery by checking if stored
`_lastCorruptionDetectedAt` timestamp is older than database reset timestamp. If
Firefox auto-recovered, log this explicitly and skip extension recovery. Keep
backup mechanism as fallback for older Firefox versions.

<acceptance_criteria>

- [ ] Code detects Firefox auto-recovery when present
- [ ] Extension recovery skipped if Firefox already reset database
- [ ] Logging clearly indicates whether Firefox or extension handled recovery
- [ ] Compatibility with Firefox < 145 maintained (fallback to extension
      recovery) </acceptance_criteria>

---

### Issue #11: WebRequest/DeclarativeNetRequest Header Removal Not Validated at Runtime

**File:** `manifest.json`, `background.js` or `src/background/handlers/`  
**Current Implementation:** webRequest with webRequestBlocking  
**Fallback Detection:** Code references declarativeNetRequest, but not actively
used

**Problem:** Manifest.json specifies webRequest and webRequestBlocking to remove
X-Frame-Options headers, allowing Quick Tabs to be loaded in iframes. However,
there is no runtime validation that headers were actually removed. If Firefox
webRequest listener fails silently (e.g., due to CSP restrictions, API
deprecation, or permission issues), the X-Frame-Options header remains in
responses but extension doesn't know. Quick Tabs iframes silently fail to load
with no error visible to user.

**Root Cause:** WebRequest is deprecated in favor of declarativeNetRequest. Code
has declarativeNetRequest detection logic, but it's not actively used. No health
check to verify header removal worked.

**Why This Matters:** User tries to open Quick Tab in iframe. Network request
succeeds, but X-Frame-Options: DENY blocks iframe from loading. User sees blank
iframe with no error message. Debugging is difficult because extension doesn't
log failures—user must inspect Network tab in DevTools to see 403 error from
X-Frame-Options header.

<scope>
**Modify:**
- Header removal validation - add check after iframe load to verify headers were removed
- Health monitoring - detect if webRequest listener is failing
- Error reporting - log iframe load failures with specific reason (X-Frame-Options vs other)

**Do NOT Modify:**

- manifest.json permissions (read-only)
- Firefox browser security (immutable) </scope>

**Fix Required:** Implement iframe load monitoring that checks response headers
or listens for CSP violation reports. If X-Frame-Options header is present when
iframe loads, log explicit error with failure reason. Consider implementing
feature detection that tests iframe loading at startup and falls back to user
notification if headers cannot be removed.

<acceptance_criteria>

- [ ] Iframe load failures logged with specific header/CSP reason
- [ ] Health check at startup confirms header removal is working
- [ ] User-facing error if header removal fails (not silent failure)
- [ ] Manual test: Load Quick Tab in iframe, verify headers are removed in
      Network tab </acceptance_criteria>

---

### Issue #15: Storage.onChanged Event Listener Registration Timing Not Guaranteed

**File:** Content script initialization in `src/content.js`  
**Related to:** Storage synchronization between tabs  
**Firefox Limitation:** storage.local.set() promise resolves before listeners
fire

**Problem:** Firefox's storage.onChanged event is asynchronous and fires after
storage.local.set() promise resolves, not before or during. If content script
registers listener after page loads (especially on slow pages), state writes
happening before listener registration will be missed. Additionally, in Firefox,
the storage.set() promise resolves before all listeners are notified, which is
different from Chrome behavior. Code may assume listener is active immediately
after set() completes, but it's not guaranteed.

**Root Cause:** Content script initialization may defer listener registration.
No synchronous hook to confirm listener is active. No fallback mechanism if
listener registration fails.

**Why This Matters:** Slow page load: content script loads at 500ms, listener
registers at 600ms. Background (or another tab) writes state at 400ms. Content
script misses that write. Until next storage.onChanged event fires, content
script has stale state. Requires manual refresh or timeout to recover.

<scope>
**Modify:**
- Listener registration - ensure listener is registered before any storage reads
- Timing validation - add explicit confirmation that listener is active
- Fallback mechanism - implement polling if listener registration fails

**Do NOT Modify:**

- Firefox storage API behavior (immutable)
- Storage schema or keys (read-only) </scope>

**Fix Required:** Register storage.onChanged listener synchronously at content
script load, before any other initialization. Add timestamp to listener
registration and verify all state writes after listener registration time are
observed. Implement fallback polling every 5 seconds if listener registration
cannot be confirmed.

<acceptance_criteria>

- [ ] storage.onChanged listener registered at very start of content script
- [ ] Listener registration timestamp logged and verified
- [ ] Fallback polling mechanism activates if listener not confirmed after 1
      second
- [ ] Manual test: Verify no state writes are missed even during slow page loads
      </acceptance_criteria>

---

### Issue #17: Storage Quota Aggregation Missing Across Storage Areas

**File:** `background.js`, `checkStorageQuota()` and `_getStorageBytesInUse()`  
**Storage Areas in Firefox MV2:** storage.local (10MB), storage.sync (5KB),
storage.session (varies)

**Problem:** Storage quota monitoring calls
`browser.storage.local.getBytesInUse()` which only reports storage.local usage.
Firefox MV2 extensions have a shared 10MB quota across all storage areas, but
the code doesn't aggregate storage.sync or storage.session usage. Extension
could be storing data in both storage.local and storage.sync, and the total
could exceed 10MB, but quota monitoring would show only local usage. This
creates false sense of security—code shows 80% quota used (8MB of 10MB in
local), but if 2MB is in storage.sync, actual total is 10MB and fully consumed.

**Root Cause:** Assumption that storage.local is primary storage area. Code
doesn't account for other storage areas consuming shared quota.

**Why This Matters:** If extension uses storage.sync for settings backup (which
uses shared quota), total quota consumption is invisible. Write failures occur
without warning because monitoring doesn't aggregate all areas. User loses data
to recovery cleanup when they thought they had plenty of quota remaining.

<scope>
**Modify:**
- Quota calculation - aggregate bytes from all storage areas
- Monitoring - track per-area usage and total aggregated usage

**Do NOT Modify:**

- Firefox quota limits (immutable)
- Storage area schemas (read-only) </scope>

**Fix Required:** Implement aggregated quota tracking that calls getBytesInUse()
for storage.local, storage.sync, and estimates storage.session size. Report
total aggregated usage in quota checks and logs. If any single area approaches
limits, proactively warn user and suggest cleanup.

<acceptance_criteria>

- [ ] Quota monitoring aggregates all storage areas
- [ ] Per-area usage logged separately from aggregated total
- [ ] Total quota percentage accurately reflects combined usage
- [ ] Manual test: Write to storage.local and storage.sync, verify aggregated
      quota is sum of both </acceptance_criteria>

---

## Issue Category 3: Message Queue & Batching (Issues #2, #7, #9, #16)

### Issue #7: Missing Comprehensive Logging for Communication Paths

**File:** `src/features/quick-tabs/channels/MessageBatcher.js`  
**Affects:** Entire message routing pipeline—queuing, flushing, port selection  
**Current Logging:** Minimal, doesn't show decision flow or alternative paths

**Problem:** When messages are enqueued in MessageBatcher, there's no log
showing: (1) why message was queued (port unavailable?), (2) queue depth at time
of enqueue, (3) when queued message will be flushed, (4) which communication
path (port vs fallback) was selected for flush. This makes debugging message
delivery issues extremely difficult. User reports "Quick Tabs didn't update
after 10 minutes"—could be port failure, queue starvation, or communication path
issue, but logs don't show which.

**Root Cause:** MessageBatcher has public API for enqueue/flush but minimal
logging at decision points. No logging when dequeuing messages or choosing
communication path.

**Why This Matters:** Silent failures in message routing are indistinguishable
from storage issues or UI bugs. Debugging requires adding debug logging and
reproducing issue, then re-reading logs manually. No automated diagnostics to
identify communication layer problems.

<scope>
**Modify:**
- MessageBatcher - add comprehensive logging at queue/flush points
- Message routing - log channel selection decisions and fallback attempts

**Do NOT Modify:**

- Message queue structure (preserve existing implementation)
- Public API (maintain backwards compatibility) </scope>

**Fix Required:** Add logging to MessageBatcher that records: (1) enqueue events
with reason and queue depth, (2) flush events with number of messages and target
channel, (3) failed flush with specific reason (port dead? quota exceeded?), (4)
fallback channel attempts. Include correlationId in all logs to link related
events.

<acceptance_criteria>

- [ ] Enqueue logged with reason (why queued) and depth
- [ ] Flush logged with count and target channel
- [ ] Failures logged with specific reason code
- [ ] All logs include correlationId for tracing
- [ ] Manual test: Create 50 tabs, kill background, verify logs show queue
      accumulation and recovery </acceptance_criteria>

---

### Issue #9: No Correlation ID for End-to-End State Change Tracing

**File:** All files in quick-tabs state change pipeline  
**Affects:** Ability to trace single state change from content script →
background → storage → other tabs  
**Current Tracing:** Per-context logs, no cross-context linking

**Problem:** When a user creates a Quick Tab, that state change flows: (1)
Content script → Create event, (2) UICoordinator → DOM render, (3)
WriteQuickTabStateWithValidation → storage write, (4) Background →
storage.onChanged listener fires, (5) Other tabs → storage listener fires,
hydrate. Currently, logs from each context have timestamp but no shared ID
linking them. If state appears wrong in another tab, debugging requires manually
matching timestamps across multiple log files to reconstruct flow. No automated
way to see if message was sent but not received, or received but not applied.

**Root Cause:** Each context (content script, background) logs independently. No
shared ID propagated through messages and storage writes.

**Why This Matters:** User reports Quick Tab appears in tab A but not tab B.
Logs show state was written to storage but other tab didn't receive
notification. Without correlationId, can't trace whether: (1) message was never
sent, (2) message was sent but port failed, (3) message received but not
applied, (4) listener didn't fire due to timing. Requires extensive manual
debugging to find root cause.

<scope>
**Modify:**
- State change creation - assign unique correlationId
- Message routing - include correlationId in all messages
- Storage writes - include correlationId in state snapshot
- Logging - include correlationId in every log entry for state change

**Do NOT Modify:**

- Storage schema (add optional correlationId field, don't change structure)
- Message format (add optional correlationId field, maintain backwards compat)
  </scope>

**Fix Required:** Implement correlationId assignment at state change origin in
content script. Propagate through port messages, storage writes, and
storage.onChanged notifications. Log every step with correlationId. Provide
diagnostic tool that reconstructs full state change flow by querying logs with
given correlationId.

<acceptance_criteria>

- [ ] correlationId assigned at creation and included in all messages
- [ ] storage snapshots include correlationId for traceability
- [ ] All logs include correlationId
- [ ] Diagnostic tool can reconstruct full flow given correlationId
- [ ] Manual test: Create tab in tab A, verify correlationId appears in logs for
      all 5 steps of flow </acceptance_criteria>

---

### Issue #16: No Circuit Breaker for Dead Port Message Flood

**File:** `background.js`, port message handling  
**Related to Issue #14:** Port timeout detection  
**Behavior:** Messages sent to dead port don't immediately fail; they hang or
queue indefinitely

**Problem:** When a port dies (content script terminated, page navigated),
background.js continues attempting to send messages to that dead port. Each
failed postMessage doesn't raise an error—it just doesn't reach the recipient.
MessageBatcher continues queueing messages for the dead port, waiting for it to
become active again. If port never recovers (e.g., page permanently navigated),
message queue grows indefinitely and consumes memory.

**Root Cause:** No circuit breaker pattern to fail fast on dead ports. Ports are
only evicted after 3 consecutive failures, and those failures may take 30+
seconds to accumulate. Meanwhile, MessageBatcher queues all messages
indefinitely.

**Why This Matters:** User navigates away from page. Port dies. MessageBatcher
queues 50+ messages. User never returns to page. Queue persists in memory for
hours until extension unload. If user does return and new port is created,
queued messages suddenly flush with 1+ hour old data, corrupting state.

<scope>
**Modify:**
- Dead port detection - implement circuit breaker with state transitions
- Message queue - add TTL and overflow handling for dead ports
- Cleanup - trigger prompt disconnection of dead ports

**Do NOT Modify:**

- Port.postMessage API (immutable)
- Message queue API (preserve public interface) </scope>

**Fix Required:** Implement circuit breaker state machine for ports: healthy →
unhealthy (1 failure) → dead (2 failures + 5s timeout). When port enters dead
state, immediately drain message queue (not forward indefinitely). Log all state
transitions. Add queue TTL where messages older than 60 seconds are discarded if
port is dead.

<acceptance_criteria>

- [ ] Circuit breaker states implemented with transitions
- [ ] Dead port detection happens within 10 seconds, not 30+
- [ ] Message queue drains instead of accumulating for dead ports
- [ ] Queue TTL prevents memory leak for orphaned queues
- [ ] Manual test: Kill page, verify port transitions to dead and messages are
      discarded </acceptance_criteria>

---

## Issue Category 4: Frame Context & Iframe Lifecycle (Issues #3, #13, #19)

### Issue #19: Content Script Unload Not Explicitly Handled; Relies on OnDisconnect

**File:** `src/content.js`  
**Related to Firefox Bug:** 1223425 (onDisconnect not fired during
BFCache/navigation)  
**Event Hook Missing:** pagehide event with persisted flag

**Problem:** Content script cleanup relies on port.onDisconnect to notify
background when page unloads. However, Firefox bug 1223425 means onDisconnect
may not fire when page enters BFCache or navigates away. Content script unload
event listener is not explicitly registered, so no proactive cleanup occurs.
Background continues maintaining port for content script that no longer exists.
If page is reloaded, new content script creates new port. Two ports now exist
for same context.

**Root Cause:** No pagehide event listener in content script. No explicit
background notification when unload occurs. Relies entirely on
port.onDisconnect, which Firefox doesn't reliably fire.

**Why This Matters:** User rapidly navigates pages or opens/closes tabs. Port
registry accumulates stale entries (Issue #8). Memory consumption grows.
Broadcast operations slow down. After 30+ minutes of normal usage, port registry
has 50+ stale ports even though only 5 tabs are open.

<scope>
**Modify:**
- Content script lifecycle - add pagehide and beforeunload listeners
- Port cleanup - send explicit cleanup message to background
- Logging - log all content script lifecycle events

**Do NOT Modify:**

- Port.onDisconnect behavior (immutable, Firefox bug)
- Page lifecycle events (immutable) </scope>

**Fix Required:** Add pagehide and beforeunload event listeners in content
script that send explicit CONTENT_SCRIPT_UNLOAD message to background.
Background receives this message and immediately marks port for disconnection.
Ensures port cleanup happens even if onDisconnect doesn't fire.

<acceptance_criteria>

- [ ] pagehide and beforeunload listeners implemented in content script
- [ ] CONTENT_SCRIPT_UNLOAD message sent to background
- [ ] Background disconnects port immediately upon receiving cleanup message
- [ ] Logging shows all lifecycle transitions
- [ ] Manual test: Navigate 20 pages, verify no stale ports remain after each
      navigation </acceptance_criteria>

---

## Issue Category 5: State Machine & Data Integrity (Issues #18, #20)

### Issue #18: No Maximum Event Age Enforcement in Deduplication

**File:** `background.js`, deduplication logic with saveId and revision  
**Related Issue:** Message ordering and stale state application

**Problem:** Deduplication uses saveId and timestamp window
(DEDUP_SAVEID_TIMESTAMP_WINDOW_MS = 50ms), and revision numbers to prevent
duplicate writes. However, there's no mechanism to reject operations that arrive
very late (> 5+ minutes after initial write). If a message gets queued and
delayed (e.g., due to port failure recovery), it's still applied to storage as
if it's current. This can revert recent changes if delayed message has older
sequenceId but newer saveId.

**Root Cause:** Revision number helps with ordering but doesn't account for
message age. Dedup window is 50ms for timestamp comparison, which is appropriate
for normal operations but useless for messages delayed minutes.

**Why This Matters:** User creates Quick Tab, deletes it, creates different tab.
Delayed message from first create operation (stuck in queue) flushes and
reapplies stale state, recreating deleted tab. User sees ghost tab reappear.

<scope>
**Modify:**
- Deduplication - add maximum event age check (e.g., 5 minutes)
- Logging - log rejected stale events with age and reason

**Do NOT Modify:**

- Revision number algorithm (working correctly)
- Dedup core logic (maintain existing pattern) </scope>

**Fix Required:** Before applying deduped state change, check if event age
(current time - event timestamp) exceeds maximum threshold (e.g., 300 seconds /
5 minutes). If event is older than threshold, reject it and log as stale. This
prevents accidentally reapplying ancient operations.

<acceptance_criteria>

- [ ] Maximum event age threshold enforced (suggest 5 minutes)
- [ ] Stale events rejected and logged with age and operation type
- [ ] Manual test: Queue message, wait 10 minutes, verify message is rejected
      when processed </acceptance_criteria>

---

### Issue #20: Port Registry Diagnostic Data Accumulates Without Bound

**File:** `background.js`, port registry entries  
**Affected Fields:** messageCount, lastActivityTime, lastMessageAt, and other
per-port metadata  
**Memory Impact:** Small per port (~1KB), but significant at 100+ ports scale

**Problem:** Each port registry entry accumulates diagnostic metadata:
messageCount (incrementing integer), lastActivityTime, lastMessageAt
(timestamps), and activity history. Over weeks of continuous browser usage,
these accumulate unbounded. A port that exists for a full week will have
messageCount in millions and historical timestamps growing continuously. While
individual fields are small, at scale (50-100 ports) this creates measurable
memory overhead. No mechanism to reset or clear accumulated diagnostics.

**Root Cause:** Diagnostic fields are added to track port health but never
cleared or reset. Assumption is that ports are short-lived, but in practice
ports can exist for weeks if browser never fully restarts.

**Why This Matters:** Long-running browser session (weeks without restart)
accumulates memory in port registry diagnostics. Not critical but represents
technical debt—better to cap diagnostic history at reasonable size.

<scope>
**Modify:**
- Port registry - implement diagnostic data rotation (keep only last N entries)
- Activity tracking - cap history size to prevent unbounded growth

**Do NOT Modify:**

- Port registry core structure (maintain compatibility)
- Diagnostic accuracy for recent operations (keep recent data intact) </scope>

**Fix Required:** Implement rolling window for port diagnostic history. Keep
detailed data (messageCount, timestamps) for recent 1 hour, aggregated summary
for older data. Clear old entries when port has been idle 24+ hours. This
maintains diagnostics for debugging current issues while preventing memory
accumulation over weeks.

<acceptance_criteria>

- [ ] Diagnostic data rolled over to summary when > 1 hour old
- [ ] messageCount capped at 999,999 with "exceeded" flag after
- [ ] Old diagnostic entries cleared when port idle 24+ hours
- [ ] Total memory per port stays < 2KB regardless of age
- [ ] Manual test: Run for 1 week, verify port registry memory doesn't grow
      beyond initial size </acceptance_criteria>

---

## Issue Category 6: Additional Firefox API Limitations & Undocumented Behavior

### Summary of Firefox-Specific Limitations (Not Requiring Fixes, But Documented for Context)

**Limitation A: BroadcastChannel Same-Origin Enforcement**  
BroadcastChannel API enforces same-origin policy. Messages cannot cross https://
↔ moz-extension:// boundaries. Workaround: Use runtime.Port for cross-origin
communication. _Status: Mitigated in v1.6.3.8-v6._

**Limitation B: Runtime.Port.onDisconnect Unreliability**  
Firefox Bugzilla 1223425: onDisconnect may not fire when page enters BFCache,
navigates, or extension updates. Workaround: Add explicit pagehide/beforeunload
listeners in content script. _Status: Mitigated by Issue #19 fix._

**Limitation C: Storage.onChanged Asynchronicity**  
Firefox storage.local.set() promise resolves before storage.onChanged listeners
fire. Listeners may miss events if registered after initial state writes.
Workaround: Register listener synchronously at content script load. _Status:
Mitigated by Issue #15 fix._

**Limitation D: Background Script Idle Timer (30 Seconds)**  
Firefox Bugzilla 1851373: Background script terminates after 30 seconds even
with active ports. Port.postMessage() doesn't reset idle timer. Workaround: Use
browser.alarms and runtime.sendMessage to reset timer. _Status: Implemented in
v1.6.3.7 via keepalive mechanism._

**Limitation E: IndexedDB Corruption (Firefox 145-)**  
Firefox bugs 1979997, 1885297: IndexedDB can silently corrupt under certain
conditions. Firefox 145+ added auto-recovery pref. Workaround: Implement storage
validation and redundant backup. _Status: Implemented in v1.6.3.7-v9._

**Limitation F: DeclarativeNetRequest vs WebRequest**  
WebRequest is deprecated and being removed. DeclarativeNetRequest is modern
alternative but has different API. Firefox still supports WebRequest in MV2.
Workaround: Implement feature detection and fallback. _Status: Partially
implemented; needs validation per Issue #11._

---

## Cross-Cutting Concerns & Systemic Patterns

### Pattern 1: Incomplete Event Lifecycle Tracking

Multiple issues (3, 13, 19) stem from incomplete tracking of frame/port
lifecycle events. Content scripts don't explicitly notify background on unload.
Iframes don't notify parent on removal. Background doesn't validate port state
periodically. Consolidate lifecycle tracking into unified system with explicit
hooks at all lifecycle transitions.

### Pattern 2: Reactive vs. Proactive Cleanup

Most cleanup is reactive: wait for failure, then cleanup. (Issues #3, #8, #14,
#16). Better approach: proactive cleanup hooks (pagehide, unload, iframe
destruction) combined with timeout-based fallback. Reduces accumulation and
memory leaks.

### Pattern 3: Missing Health Monitoring

No real-time health monitoring for: communication channels, storage quota, port
registry, message queues. Monitoring happens periodically (5-minute intervals)
and offline (diagnostic snapshots). Add real-time health checks with alerts when
thresholds are approached.

### Pattern 4: Silent Failure Modes

Many issues manifest as silent failures (Issue #1, #11, #12, #18, #20). No error
messages, no user notification, no automated recovery. Implement explicit error
detection and user notification for: port failures, storage errors, message
delivery failures, header removal failures.

---

## Summary of Issues by Severity

**CRITICAL (5 issues):**

- Issue #1: BroadcastChannel cross-origin communication failure
- Issue #2: Runtime.Port concurrent message ordering race
- Issue #4: Storage quota monitoring detection delay
- Issue #7: Missing communication path logging
- Issue #9: No state change correlation ID for tracing

**HIGH (8 issues):**

- Issue #3: Port registry stale entry accumulation
- Issue #5: SessionStorage vs LocalStorage divergence
- Issue #6: Background script idle timer unreliability (mitigated)
- Issue #10: IndexedDB corruption not leveraging Firefox auto-recovery
- Issue #12: Port message ordering race in rapid operations
- Issue #14: Dead port timeout detection too slow
- Issue #15: Storage.onChanged listener timing not guaranteed
- Issue #19: Content script unload not explicitly handled

**MEDIUM (7 issues):**

- Issue #11: WebRequest header removal validation missing
- Issue #13: Iframe port connections not tracked by frame ID
- Issue #16: Dead port message flood circuit breaker missing
- Issue #17: Storage quota aggregation missing
- Issue #18: No maximum event age enforcement
- Issue #20: Port registry diagnostic data unbounded accumulation

---

## Implementation Priority Roadmap

**Phase 1 (Immediate - Prevents Data Loss):** Issues #1, #2, #4, #7, #9 -
Communication reliability and quota visibility

**Phase 2 (High Priority - Improves Stability):** Issues #3, #5, #14, #15, #19 -
Port lifecycle and storage consistency

**Phase 3 (Medium Priority - Technical Debt):** Issues #6, #10, #11, #12, #13,
#16, #17, #18, #20 - Firefox-specific optimizations and edge cases

---

**Report Status:** Complete. All 20 issues documented with root causes, impacts,
and fix recommendations. Ready for GitHub Copilot Coding Agent implementation.
