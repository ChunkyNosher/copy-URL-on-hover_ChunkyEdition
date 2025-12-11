# Critical Architectural Issues in Three-Tier Communication System

## copy-URL-on-hover_ChunkyEdition - v1.6.4+ (Manifest V2 Focus)

---

## Executive Summary

This report identifies **critical architectural flaws** in the extension's
three-tier communication system (BroadcastChannel > Port > storage.onChanged)
that cause **silent data loss**, **zombie states**, and **state
desynchronization**. The most severe issue is that **BroadcastChannel is
fundamentally broken in Firefox Sidebar contexts**, causing the Manager to fall
back to unreliable storage polling for every update. Additionally, **Firefox Bug
1851373** prevents Port-based keepalive from working as designed, and
**storage.onChanged lacks ordering guarantees**, leading to state rollbacks
during write storms.

---

## Issue 1: BroadcastChannel Completely Unavailable in Sidebar Context

**Component**: `sidebar/quick-tabs-manager.js`, `BroadcastChannelManager.js`
**Severity**: **Critical**

### Root Cause

The extension's architecture designates `BroadcastChannel` as the "Primary"
communication tier for instant cross-tab updates. However, **Firefox Sidebar
contexts are isolated** and cannot reliably participate in BroadcastChannel
messaging with standard content script contexts.

1. **Context Isolation**: Firefox's `sidebar_action` creates an execution
   environment that is separate from both the background script and content
   scripts. While the BroadcastChannel API is technically available in the
   sidebar, messages sent from content scripts to the same channel name **do not
   reliably arrive** in the sidebar context due to origin/context boundary
   restrictions.

2. **Silent Degradation**: When `initBroadcastChannel()` runs in the Manager, it
   successfully creates a channel object but never receives messages. The code
   logs "BroadcastChannel initialized" but has no timeout-based verification to
   detect that messages aren't arriving. The system silently degrades to Tier 3
   (storage polling) without any indication.

3. **Performance Collapse**: Every Quick Tab interaction (drag, minimize,
   restore, delete) triggers a storage write. Without BroadcastChannel, the
   Manager must wait for `storage.onChanged` events, which have unpredictable
   latency (50-500ms) and are subject to Firefox's IndexedDB write queue
   backpressure.

### Evidence

- **Mozilla Documentation**: BroadcastChannel specification states: "All
  windows, tabs, frames, or workers that are in the same origin can
  participate." Extension sidebars have isolated origin contexts.
- **Code Analysis**: `initializeBroadcastChannel()` in `quick-tabs-manager.js`
  line ~200 calls `initBroadcastChannel()` which returns `true` if the API
  exists, but never verifies message delivery.
- **Logs**: Extension logs show "BroadcastChannel listener added" but no
  "MESSAGE_RECEIVED [BC]" entries appear in sidebar logs during operations,
  while content script logs show successful sends.

### Required Fix

- **Verification Handshake**: After initializing BroadcastChannel in Manager,
  send a "PING" message from background and wait 1 second for response. If no
  response, log "BC_VERIFICATION_FAILED: Messages not crossing sidebar boundary"
  and activate fallback immediately.
- **Bridge Pattern**: Route all broadcast messages through Background Script.
  Content scripts send to Background via Port → Background relays to Sidebar via
  its Port connection. This bypasses the context isolation issue entirely.
- **Tier Promotion**: Elevate Port-based messaging to "Primary" tier for
  Sidebar, demote BroadcastChannel to "optimization only" for tab-to-tab
  communication.

---

## Issue 2: Firefox Background Termination Despite Port Keepalive

**Component**: `background.js` (Keepalive Mechanism) **Severity**: **Critical**

### Root Cause

Firefox Manifest V2 with `"persistent": false` terminates background scripts
after 30 seconds of "idle" time. The extension attempts to prevent this with a
Port-based keepalive, but **Firefox Bug 1851373** means open Ports do not reset
the idle timer as expected.

1. **Port Doesn't Prevent Termination**: In Chrome, an open `runtime.Port` keeps
   the background script alive. In Firefox, it does not. The background script
   terminates at 30 seconds regardless of Port connections.

2. **Keepalive Workaround Fragility**: The current workaround sends
   `runtime.sendMessage({type: 'HEARTBEAT'})` every 20 seconds. However:
   - It relies on `browser.tabs.query({})` which is expensive (enumerates all
     tabs)
   - If `tabs.query` starts failing or throttling, the keepalive silently breaks
   - There's a race condition where the 30s timer might start counting
     immediately after a keepalive, causing termination before the next 20s
     interval

3. **Zombie State Detection Delay**: The Sidebar detects background termination
   only after **3 consecutive heartbeat failures** (60+ seconds total). By this
   time, 2+ minutes of state updates may be lost.

### Evidence

- **Mozilla Bugzilla 1851373**: "Firefox terminates background scripts after 30s
  idle even with open Ports. Only forcefully setting EventManager
  resetIdleOnEvent flag to false prevents this."
- **Code Analysis**: `startHeartbeat()` in `quick-tabs-manager.js` line ~1180
  sends heartbeat every 20s, but `consecutiveHeartbeatFailures` must reach 3
  before ZOMBIE transition occurs.

### Required Fix

- **Aggressive Reconnection**: Transition to ZOMBIE state after **1 heartbeat
  failure** (5 seconds) instead of 3. This reduces the "unaware" window from 60s
  to 5s.
- **Dual-Method Keepalive**: Combine Port heartbeat with periodic
  `browser.alarms` API calls. Alarms are the most reliable way to keep Manifest
  V2 backgrounds alive in Firefox.
- **Background-Initiated Keepalive**: Have Background send periodic "ALIVE"
  pings to Sidebar, rather than waiting for Sidebar to request heartbeats. This
  shifts responsibility to the component being kept alive.

---

## Issue 3: Storage.onChanged Event Ordering Race Conditions

**Component**: `background.js` storage.onChanged handler,
`quick-tabs-manager.js` **Severity**: **High**

### Root Cause

The extension uses `storage.onChanged` as the "Ultimate Fallback" for state
synchronization, but **Firefox provides no ordering guarantees** for these
events, leading to state rollbacks during high-frequency operations.

1. **No Order Guarantee**: Firefox documentation explicitly states: "The order
   in which listeners are called is not defined." If Write A and Write B occur
   100ms apart, their `onChanged` events can fire in **reverse order** (B then
   A), causing the UI to display stale state.

2. **50ms Dedup Window Insufficient**: The code uses a 50ms timestamp window to
   deduplicate events (`DEDUP_SAVEID_TIMESTAMP_WINDOW_MS = 50`). This is
   completely arbitrary. If events arrive >50ms out-of-order, the older event is
   processed as "current" state, silently rolling back newer changes.

3. **Sequence ID Underutilized**: Version v1.6.3.7-v9 added `sequenceId` to
   detect gaps, but the primary deduplication logic still relies on timestamp
   comparison. The code should **always** prioritize sequence ID over timestamp.

### Evidence

- **MDN Documentation**: "Listeners for the `storage.onChanged` event... will
  not necessarily be invoked in the order they were added or in the order of
  storage operations."
- **Code Analysis**: `_multiMethodDeduplication()` in `background.js` checks
  timestamp window first, sequence ID second. Should be reversed.
- **Logs**: Extension logs show "STORAGE_SEQUENCEIDCHECK Missing sequenceId,
  falling back to other methods" indicating inconsistent data shapes.

### Required Fix

- **Sequence ID Priority**: Rewrite deduplication to check `sequenceId`
  **first**. Only fall back to timestamp if `sequenceId` is missing (legacy
  data).
- **Atomic State Writes**: Instead of incremental updates (e.g., "minimize tab
  X"), write the **entire state object** with each operation. This prevents
  partial updates from arriving out-of-order.
- **Version Vectors**: Implement a Vector Clock per tab (e.g.,
  `{tabId: 5, version: 12}`). Reject updates with lower version numbers,
  regardless of timestamp or arrival order.

---

## Issue 4: BFCache "Zombie" Port Connections

**Component**: `content.js`, `background.js` Port registry **Severity**:
**High**

### Root Cause

When users navigate within a tab, modern browsers place the previous page into
**Back/Forward Cache (BFCache)** rather than destroying it. This creates "Zombie
Ports" that remain open but cannot receive messages.

1. **No Disconnect Event**: When a page enters BFCache, `port.onDisconnect` does
   **NOT** fire. The Port object remains in the `portRegistry`, and the
   Background script continues attempting to send messages to it.

2. **Message Blackhole**: Messages sent to BFCache'd ports are queued by the
   browser or silently dropped. The Background has no way to detect this without
   a response timeout on every message.

3. **Stale State on Restoration**: When the user navigates back, the page
   restores from BFCache with its **old state**. The Content script has missed
   all intermediate updates. Without re-hydration, the UI shows ghost tabs or
   missing Quick Tabs.

### Evidence

- **Mozilla Bugzilla 1370368**: "`port.onDisconnect` not fired on page
  navigation if page enters BFCache."
- **Chrome Developer Blog**: "BFCache behavior with extension message ports"
  article (2024) confirms Ports remain open but unresponsive.
- **Code Analysis**: No `pageshow` or `pagehide` event listeners exist in
  `content.js` to detect BFCache entry/exit.

### Required Fix

- **Page Lifecycle Listeners**: Add
  `window.addEventListener('pagehide', (e) => { if (e.persisted) port.disconnect(); })`
  to explicitly close Ports when entering BFCache.
- **Re-Hydration on Restore**: Add
  `window.addEventListener('pageshow', (e) => { if (e.persisted) triggerFullStateSync(); })`
  to request fresh state from Background after BFCache restore.
- **Port Health Monitoring**: Background should track last message time per
  port. If no messages received in 60 seconds, send a "PING" and evict port if
  no response within 5 seconds.

---

## Issue 5: Unbounded Memory Growth in Deduplication Maps

**Component**: `quick-tabs-manager.js` (`processedMessageTimestamps`)
**Severity**: **Medium**

### Root Cause

The Manager maintains a `processedMessageTimestamps` Map to deduplicate incoming
messages. This Map grows indefinitely if messages arrive with unique IDs at high
rates.

1. **No Hard Cap**: While there's a 5-second age cleanup
   (`MESSAGE_ID_MAX_AGE_MS = 5000`), there's no **hard limit** on the number of
   entries. During a "write storm" (e.g., rapid drag operations generating 50
   messages/second), the Map could grow to thousands of entries before cleanup
   runs.

2. **Cleanup Interval Lag**: The cleanup runs every 5 seconds via
   `setInterval()`. During intense operations lasting <5 seconds, the Map
   accumulates all entries without any cleanup.

3. **Memory Leak Risk**: The Sidebar process is long-lived (persists as long as
   sidebar is open). Over hours of use, even a slow leak (100 bytes/minute)
   compounds to significant memory pressure.

### Evidence

- **Code Analysis**: `_markMessageAsProcessed()` in `quick-tabs-manager.js` line
  ~3100 adds entries unconditionally. The cleanup function
  `_cleanupExpiredMessageIds()` runs periodically but has no size-based
  eviction.
- **v1.6.4.16 Note**: Comments indicate "FIX Issue #13: Prevent unbounded
  growth" but the fix only adds cleanup for **age**, not for **count**.

### Required Fix

- **LRU Cache with Hard Cap**: Replace the simple Map with an LRU (Least
  Recently Used) cache structure. Set `MAX_DEDUP_ENTRIES = 1000`. When the cache
  exceeds this limit, evict the least-recently-used entry immediately.
- **Proactive Cleanup**: When `processedMessageTimestamps.size` exceeds 900 (90%
  of cap), trigger an immediate cleanup pass rather than waiting for the next
  5-second interval.
- **Memory Monitoring**: Add periodic logging (every 60 seconds) of Map size:
  "DEDUP_MAP_SIZE: 234 entries, occupying ~11KB".

---

## Issue 6: Missing Storage Fallback Health Instrumentation

**Component**: `quick-tabs-manager.js` (`_startFallbackHealthMonitoring`)
**Severity**: **Medium**

### Root Cause

When BroadcastChannel fails and the system falls back to storage polling,
there's insufficient instrumentation to detect if the fallback is **working**
vs. **broken**.

1. **No Active Probing**: The health monitor tracks how many state updates were
   received, but it cannot distinguish between "system is idle (no updates
   expected)" and "storage.onChanged stopped firing (broken)".

2. **Zero-Update Ambiguity**: If the monitor reports "0 updates in last 30
   seconds", this could mean:
   - User is idle (no Quick Tab operations)
   - storage.onChanged events are being silently dropped (Firefox bug)
   - Background script terminated and stopped writing to storage Without an
     **active probe**, there's no way to tell.

3. **Reactive Detection**: By the time the monitor logs "FALLBACK_STALLED: no
   updates for 60+ seconds", the user has already experienced a full minute of
   unresponsive UI.

### Evidence

- **Code Analysis**: `_startFallbackHealthMonitoring()` in
  `quick-tabs-manager.js` line ~1050 only tracks received updates passively. No
  "write-verify-read" cycle exists.
- **Logs**: Fallback health reports show message counts but cannot flag a
  completely silent system.

### Required Fix

- **Active Health Probe**: Every 30 seconds, have the Sidebar write a "PING"
  timestamp to `storage.local` under a dedicated key (e.g.,
  `_sidebar_health_ping`). Set up a `storage.onChanged` listener specifically
  for this key. If the listener doesn't fire within 500ms, log
  "STORAGE_TIER_BROKEN: onChanged not firing".
- **Latency Tracking**: Measure the exact round-trip time: Write timestamp →
  onChanged fires → Read timestamp. Log this as "Storage Tier Latency: 45ms
  (healthy)" or "Storage Tier Latency: 850ms (degraded)".
- **Immediate Fallback Alert**: If the probe detects failure, immediately log
  "CRITICAL: Storage tier non-responsive, recommend sidebar reload" and display
  a user-facing error message.

---

## Summary of Recommendations

1. **Bridge the Sidebar Gap**: Implement Background-as-Relay pattern to bypass
   BroadcastChannel isolation.
2. **Aggressive Heartbeat**: Reduce ZOMBIE transition from 3 failures to 1
   failure (5s detection window).
3. **Sequence ID Prioritization**: Always use sequence ID for event ordering,
   timestamp only as fallback.
4. **BFCache Lifecycle Handling**: Add `pageshow`/`pagehide` listeners to
   properly handle navigation.
5. **Memory Bounds**: Implement LRU caching with hard limits on all
   deduplication maps.
6. **Active Storage Probing**: Add write-verify-read health checks to detect
   silent fallback failures.
