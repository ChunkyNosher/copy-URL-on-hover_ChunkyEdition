# Quick Tabs State Sync: Comprehensive Logging & Visibility Gaps

**Extension Version:** v1.6.3.7-v5 | **Date:** December 9, 2025 | **Scope:** State synchronization, message routing, and operation visibility across background, sidebar, and content scripts

---

## Executive Summary

The Quick Tabs extension's state synchronization layer operates across three independent message channels (BroadcastChannel, runtime.Port, storage.onChanged) with complex deduplication logic. A comprehensive audit reveals **nine interconnected visibility gaps** where critical state transitions, message flows, and operation outcomes lack adequate logging. These gaps make debugging difficult and obscure race conditions during concurrent operations. The issues cluster around four themes: missing command initiation logging, incomplete response validation, unclear failure recovery, and channel routing ambiguity.

---

## Issue #1: Clear All Command Missing Initiation Logging

**Severity:** MEDIUM | **Impact:** Blind spot in operation lifecycle  
**File:** `sidebar/settings.js` (Clear All button handler)

### Problem Summary
When a user clicks "Clear All Quick Tabs", the command is dispatched to background via `browser.runtime.sendMessage()` without any logging entry point. This leaves no trace in console logs that the operation began, making it impossible to correlate the user action with subsequent background processing. If the operation fails silently or takes unexpected time, there is no starting timestamp or initial state snapshot to reference.

### Root Cause
The Clear All button handler in `sidebar/settings.js` performs a simple `try { sendMessage(...) } catch { showStatus(...) }` pattern. There is no `console.log()` call that records:
- The command initiation event
- Current tab count before clear
- Correlation ID for tracing through the system
- Timestamp for latency measurement

### Fix Required
Add comprehensive logging at the Clear All command initiation point in the button click handler. The log must capture the current Quick Tab count from local state before sending the message, generate a correlation ID (or reuse message ID if available), and record this as the operation entry point. This ensures end-to-end tracing from user click through background processing to final acknowledgment.

<scope>
**Modify:**
- `sidebar/settings.js` (Clear All button click handler around COORDINATED_CLEAR_ALL_QUICK_TABS sendMessage call)

**Do NOT Modify:**
- `background.js` (handle separately as Issue #7)
- `sidebar/quick-tabs-manager.js` (read-only context)
- Button UI or user-facing confirmations
</scope>

<acceptance_criteria>
- [ ] Logging appears in console with "[Settings] CLEAR_ALL_COMMAND_INITIATED" prefix when user clicks Clear All
- [ ] Log includes: timestamp, current Quick Tab count, correlation ID (if applicable)
- [ ] Log appears BEFORE the browser.runtime.sendMessage() call executes
- [ ] No additional delays to user experience; logging is synchronous
- [ ] Manual test: Click Clear All → Verify console shows both command initiation and eventual response
</acceptance_criteria>

<details>
<summary>Code Location Details</summary>

The handler is in `sidebar/settings.js` in the click listener for element `#clearStorageBtn`. It currently has a confirm dialog, then calls `browser.runtime.sendMessage({ action: 'COORDINATED_CLEAR_ALL_QUICK_TABS' })` and handles the response via `_handleClearResponse()`. The logging gap is between the confirm and the sendMessage call.

</details>

---

## Issue #2: Clear All Response Incomplete Validation & Logging

**Severity:** MEDIUM | **Impact:** Silent degradation; operation metrics lost  
**File:** `sidebar/settings.js` (_handleClearResponse function)

### Problem Summary
When the background sends back a response to COORDINATED_CLEAR_ALL_QUICK_TABS (containing `successCount`, `failCount`, `totalTabs`), the Manager's response handler only checks `response.success` and shows a generic user-facing message. The detailed metrics about how many tabs acknowledged the clear operation are completely discarded. If some tabs fail to acknowledge, the user sees "cleared" but has no visibility into partial failures.

### Root Cause
The response handler `_handleClearResponse()` in `sidebar/settings.js` is minimal:
- It checks only `response.success` boolean
- It does not log or display `successCount` vs `failCount` breakdown
- It does not capture `totalTabs` to verify all tabs were notified
- The background's `_broadcastQuickTabsClearedToTabs()` function returns detailed counts, but the Manager discards them

### Fix Required
Enhance the Clear All response handler to extract and log all response metrics. Add console logging that shows successCount, failCount, and totalTabs from the response object. If failCount > 0, log a warning with which tabs (or how many) failed to acknowledge. Update any Manager UI elements to display this information if appropriate, or at minimum ensure console logs capture it for debugging.

<scope>
**Modify:**
- `sidebar/settings.js` (_handleClearResponse function and any response-consuming code paths)

**Do NOT Modify:**
- `background.js` (already returns detailed response; output end is handled in settings.js)
- `sidebar/quick-tabs-manager.js`
- User confirmation dialogs or main Clear All flow
</scope>

<acceptance_criteria>
- [ ] Response handler logs all metrics: successCount, failCount, totalTabs with "[Settings] CLEAR_ALL_RESPONSE" prefix
- [ ] If failCount > 0, console shows warning with count and affected tab info
- [ ] Correlation ID from Issue #1 is preserved and logged in response handler (for end-to-end tracing)
- [ ] Manual test: Clear All with some tabs closed/unresponsive → Console shows partial failure breakdown
- [ ] Manual test: Clear All with all tabs responsive → Console shows "X success, 0 failed, X total"
</acceptance_criteria>

<details>
<summary>Expected Response Structure</summary>

The background handler COORDINATED_CLEAR_ALL_QUICK_TABS returns:
```javascript\n{ success: true, successCount: 10, failCount: 2, totalTabs: 12 }\n```

The Manager currently only sees `response.success` and ignores the count fields. The fix extracts and logs those fields.

</details>

---

## Issue #3: Port Connection State Transitions Lack Context Logging

**Severity:** HIGH | **Impact:** Difficult to trace connection health or reconnection delays  
**File:** `sidebar/quick-tabs-manager.js` (_transitionConnectionState function and callers)

### Problem Summary
The port connection state machine (CONNECTED → ZOMBIE → DISCONNECTED) uses a `_transitionConnectionState()` function to log transitions, but the logs lack context about why the transition occurred, how long the previous state lasted, or what recovery actions are being taken. When debugging connection issues, it is unclear whether a ZOMBIE state is transient or persistent, or how many consecutive failures led to DISCONNECTED.

### Root Cause
The `_transitionConnectionState()` function logs the old and new state, but callers do not provide or log:
- Duration in previous state (time measurement)
- Reason for transition (heartbeat timeout, onDisconnect event, explicit close, etc.)
- Consecutive failure count at transition time
- Recovery action being triggered by this state change

Additionally, state transitions can be triggered from multiple places (`_handleHeartbeatFailure()`, `_handlePortDisconnected()`, etc.) without a consistent logging pattern, leading to incomplete state histories.

### Fix Required
Enhance all connection state transition points to log comprehensive context. Before calling `_transitionConnectionState()`, compute and pass or log separately:
- Time spent in current state (Date.now() - stateEnteredAt)
- Transition reason (heartbeat-timeout, port-disconnect-event, explicit-reconnect, etc.)
- Consecutive failure count (if applicable)
- Whether this transition triggers a fallback (e.g., BroadcastChannel activation)

Ensure that `_transitionConnectionState()` logs not only the state change but also this contextual data. Consider adding a "connection health" snapshot log at the transition point showing the previous state duration and recovery strategy.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (_transitionConnectionState function)
- All callers of _transitionConnectionState (at least _handleHeartbeatFailure, _handlePortDisconnected, connectToBackground)

**Do NOT Modify:**
- Core state machine logic or state values
- Port connection/disconnection mechanics
- Heartbeat interval or timeout constants
</scope>

<acceptance_criteria>
- [ ] Each state transition logs with "[Manager] CONNECTION_STATE_TRANSITION" prefix
- [ ] Log includes: previous state, new state, duration in previous state (ms), transition reason
- [ ] If consecutive failures contributed to transition, include failure count
- [ ] If fallback channel is being activated, log explicitly (e.g., "BroadcastChannel fallback activated due to ZOMBIE state")
- [ ] Manual test: Manually stop background process → Monitor logs for CONNECTED → ZOMBIE transition with full context
- [ ] Manual test: Resume background → Monitor logs for ZOMBIE → CONNECTED with recovery duration
</acceptance_criteria>

<details>
<summary>State Transition Scenarios</summary>

Current state transitions occur at:
1. Initial connection in `connectToBackground()` (DISCONNECTED → CONNECTED)
2. Heartbeat timeout in `_handleHeartbeatFailure()` (CONNECTED → ZOMBIE)
3. Port disconnect event in `_handlePortDisconnected()` (any state → DISCONNECTED)
4. Explicit reconnect after MAX_FAILURES (ZOMBIE/DISCONNECTED → reconnect attempt)

Each needs contextual logging showing why and how long the transition took.

</details>

---

## Issue #4: Deduplication Decision Logging Incomplete

**Severity:** MEDIUM | **Impact:** Unclear why storage changes are silently skipped  
**File:** `background.js` (_multiMethodDeduplication and _shouldIgnoreStorageChange)

### Problem Summary
The background script uses three independent deduplication methods (transactionId check, saveId+timestamp comparison, content hash comparison) to filter redundant storage change events. When a storage change is skipped due to deduplication, the logging indicates WHICH method matched but does not provide visibility into WHAT criteria was compared or WHY it matched. Additionally, the IN_PROGRESS_TRANSACTIONS set is never exposed in logs, so the size and lifetime of tracked transactions remain opaque.

### Root Cause
The `_multiMethodDeduplication()` function returns `{ shouldSkip, method, reason }`, and `_shouldIgnoreStorageChange()` logs this result. However:
- Before dedup is called, there is no log of the incoming saveId, timestamp, and transactionId values being compared
- Inside each dedup check, the comparison values (old vs new) are not logged
- The IN_PROGRESS_TRANSACTIONS set size is never logged or monitored
- When a transactionId match occurs, there is no indication of how long that transaction has been in progress

### Fix Required
Add detailed logging at multiple points in the deduplication flow:
1. Before calling `_multiMethodDeduplication()`, log the incoming saveId, timestamp, and transactionId for context
2. Inside or around each dedup method check, log the actual values being compared (old saveId vs new saveId, old hash vs new hash, etc.)
3. When a transactionId match is detected, log the transaction's elapsed time and origin
4. Periodically (or when threshold exceeded) log the size and contents of IN_PROGRESS_TRANSACTIONS
5. After dedup decision, log the final result with matched method and reason

<scope>
**Modify:**
- `background.js` (_multiMethodDeduplication function and dedup method helpers)
- `background.js` (_shouldIgnoreStorageChange function to add pre-dedup logging)
- `background.js` (transactionId tracking and IN_PROGRESS_TRANSACTIONS management)

**Do NOT Modify:**
- Core dedup logic or matching criteria
- Storage write mechanics
- Transaction lifecycle outside of logging
</scope>

<acceptance_criteria>
- [ ] Pre-dedup log shows: incoming saveId, timestamp, transactionId values with "[Background] STORAGE_CHANGE_RECEIVED" prefix
- [ ] Each dedup method logs intermediate comparison results (e.g., "saveId match: OLD=abc vs NEW=abc")
- [ ] When transactionId match detected, log shows: transaction ID, elapsed time, origin/source
- [ ] Warn if IN_PROGRESS_TRANSACTIONS exceeds size threshold (e.g., > 10 concurrent transactions)
- [ ] Final dedup decision log includes: method matched, reason, decision (skip/process)
- [ ] Manual test: Rapid storage updates → Verify dedup logs show which updates were skipped and why
- [ ] Manual test: Long-running transaction → Verify IN_PROGRESS_TRANSACTIONS tracking is visible in logs
</acceptance_criteria>

<details>
<summary>Dedup Methods Overview</summary>

1. **transactionId check:** Skips if transactionId is in IN_PROGRESS_TRANSACTIONS set
2. **saveId+timestamp check:** Skips if saveId and timestamp both match recent write
3. **content hash check:** Skips if saveId matches and content hash identical (Firefox spurious event detection)

Each method needs logging showing the comparison.

</details>

---

## Issue #5: Keepalive Health Monitoring Absent

**Severity:** MEDIUM | **Impact:** Silent failure of Firefox idle timer workaround  
**File:** `background.js` (startKeepalive, triggerIdleReset)

### Problem Summary
The extension implements a keepalive interval (`KEEPALIVE_INTERVAL_MS = 20000`) that periodically calls `triggerIdleReset()` to prevent Firefox from terminating the background script after 30 seconds of inactivity (Bug 1851373). The keepalive logs its initial start but does not log periodic executions (to avoid spam) and does not monitor whether idle reset is actually succeeding. If `tabs.query()` or `runtime.sendMessage()` fails silently, the keepalive is broken but no alert is generated.

### Root Cause
The `triggerIdleReset()` function logs success messages but:
- Errors in `tabs.query()` or `runtime.sendMessage()` are caught with a generic `.catch()` or `console.warn()` only
- There is no tracking of last successful reset timestamp for health checking
- The keepalive interval logs "started" at script load but never logs subsequent interval executions
- If keepalive fails multiple times in a row, there is no escalating alert or warning

### Fix Required
Implement periodic health checks for the keepalive mechanism. Track the timestamp of the last successful `triggerIdleReset()` call. At a reasonable interval (e.g., every 60 seconds), verify that enough time has NOT elapsed since the last success. If too much time has passed, log a warning that keepalive may have failed. Additionally, add rate-limited success/failure logging for each idle reset attempt (e.g., log every 10th success or every failure) so that keepalive health is visible without spam.

<scope>
**Modify:**
- `background.js` (triggerIdleReset function to track success timestamp and add error clarity)
- `background.js` (startKeepalive or a new keepalive health check interval to monitor last-success)
- Error handling in tabs.query and runtime.sendMessage calls within triggerIdleReset

**Do NOT Modify:**
- Keepalive interval timing (20 seconds)
- Firefox idle timer constant (30 seconds)
- Core idle reset mechanism (tabs.query + sendMessage)
</scope>

<acceptance_criteria>
- [ ] Keepalive mechanism logs "[Background] KEEPALIVE_RESET_SUCCESS" when idle timer is successfully reset
- [ ] If tabs.query fails, log "[Background] KEEPALIVE_RESET_FAILED" with error details
- [ ] If runtime.sendMessage fails, log "[Background] KEEPALIVE_RESET_FAILED" with error details
- [ ] Health check every 60 seconds compares current time to last-success timestamp
- [ ] If last success > 90 seconds ago, log "[Background] KEEPALIVE_HEALTH_WARNING" with time since last success
- [ ] Manual test: Let extension run for 2 minutes → Verify periodic success logs appear
- [ ] Manual test: Simulate tabs.query failure → Verify failure log appears and health warning triggers
</acceptance_criteria>

<details>
<summary>Idle Timer Context</summary>

Firefox terminates background scripts after ~30 seconds of inactivity. The keepalive workaround uses `tabs.query()` and `runtime.sendMessage()` calls as synthetic activity. Both operations reset the idle timer. If both fail, the background may be terminated unexpectedly, causing all state coordination to halt.

</details>

---

## Issue #6: Port Registry Lifecycle Lacks Visibility

**Severity:** LOW | **Impact:** Impossible to detect port leaks or connection churn  
**File:** `background.js` (portRegistry, cleanupStalePorts, port lifecycle)

### Problem Summary
The background maintains a `portRegistry` Map to track connected ports for persistent communication. The registry cleanup runs every 5 minutes but logs minimal details: it does not show how many ports existed before cleanup, which ports were considered stale, or how many remain after cleanup. If ports are leaking or growing unboundedly, there is no alarm. Additionally, ports can be removed via multiple paths (onDisconnect listener, periodic cleanup, tab removal) without unified logging that shows the registry state at each change.

### Root Cause
Port lifecycle events (connect, disconnect, cleanup) log individual events but do not provide:
- Registry size before/after each event (to detect leaks)
- Port stale-check criteria and which ports matched (inactivity, tab missing, etc.)
- Registry composition by port type (sidebar, content-tab-X, etc.)
- Warning when registry exceeds reasonable size (e.g., > 100 ports)

### Fix Required
Enhance port registry logging to show comprehensive lifecycle details. When ports are registered, log the registry size. When cleanup runs, log before-count and after-count of ports, and enumerate which ports were removed with reasons (inactivity duration exceeded, tab no longer exists, etc.). Periodically log registry composition (count by port type). Add a threshold warning if port count exceeds expected maximum (e.g., warn at > 50 ports, critical warn at > 100 ports).

<scope>
**Modify:**
- `background.js` (port registration/deregistration logging)
- `background.js` (cleanupStalePorts or port cleanup interval to add comprehensive logging)
- Port onDisconnect listeners and tab removal handlers

**Do NOT Modify:**
- Port connection/disconnection mechanics
- Cleanup interval timing (5 minutes)
- Port data structure or lifecycle state machine
</scope>

<acceptance_criteria>
- [ ] Each port connect logs "[Background] PORT_REGISTERED" with port ID, origin, and current registry size
- [ ] Each port disconnect logs "[Background] PORT_UNREGISTERED" with reason (onDisconnect, cleanup, tab removal)
- [ ] Cleanup interval logs "[Background] PORT_CLEANUP_START" before cleanup executes
- [ ] Cleanup logs "[Background] PORT_CLEANUP_COMPLETE" with before count, after count, removed count
- [ ] Cleanup logs which ports were removed and why (e.g., "inactivity_60min", "tab_missing", etc.)
- [ ] Warn if registry size exceeds 50 ports (warn level), 100+ ports (critical level)
- [ ] Manual test: Open/close multiple tabs with Quick Tabs → Verify port count tracking in cleanup logs
</acceptance_criteria>

<details>
<summary>Port Lifecycle Paths</summary>

Ports are removed via:
1. `onDisconnect` listener when port naturally closes
2. `cleanupStalePorts()` when ports exceed inactivity threshold
3. `chrome.tabs.onRemoved` listener when origin tab is closed

Each removal path should log with unified format showing reason and registry state change.

</details>

---

## Issue #7: Message Channel Source Ambiguity

**Severity:** MEDIUM | **Impact:** Difficult to trace which channel delivered a message  
**File:** `sidebar/quick-tabs-manager.js` (message listeners and routing)

### Problem Summary
State updates arrive via three independent channels: BroadcastChannel, runtime.Port (via port.onMessage), and storage.onChanged events. Each channel logs its messages differently (some as `PORT_MESSAGE_RECEIVED`, some as state change, some not at all). When debugging why the Manager is in a particular state, it is difficult to determine which channel delivered the current state or whether multiple channels have diverged (each showing different state). This ambiguity is especially problematic during ZOMBIE state when port is unreliable and BroadcastChannel + storage become primary.

### Root Cause
Message logging uses inconsistent prefixes and terminology:
- Port messages: `PORT_MESSAGE_RECEIVED [action] ...`
- Runtime messages: `RUNTIME_MESSAGE_RECEIVED [type] ...`
- Storage changes: Logged as state update, not as message arrival
- BroadcastChannel: Logged as state update, not channel source

Additionally, there is no unified message ID or correlation ID that follows a message through all three channels, making it impossible to correlate deduplication across channels or detect which channel "won" for a particular state update.

### Fix Required
Implement unified message routing logging that explicitly identifies the channel source. Add a consistent log prefix format that includes: channel source (BC=BroadcastChannel, PORT=runtime.connect, STORAGE=storage.onChanged), message type/action, message ID (if available), and deduplication status. Create a routing trace at the entry point for each channel (e.g., BroadcastChannel onMessage listener, port.onMessage listener, storage.onChanged listener for Quick Tabs state key).

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (BroadcastChannel onMessage listener logging)
- `sidebar/quick-tabs-manager.js` (port.onMessage listener logging)
- `sidebar/quick-tabs-manager.js` (storage.onChanged listener logging for quick_tabs_state_v2 changes)
- Message deduplication logic to track and log channel source of deduplicated messages

**Do NOT Modify:**
- Core message flow or routing logic
- Deduplication criteria or matching
- Channel fallback behavior
</scope>

<acceptance_criteria>
- [ ] BroadcastChannel messages log as "[Manager] MESSAGE_RECEIVED [BC] [ACTION]" with message ID
- [ ] Port messages log as "[Manager] MESSAGE_RECEIVED [PORT] [ACTION]" with message ID
- [ ] Storage changes log as "[Manager] MESSAGE_RECEIVED [STORAGE] [saveId]" with storage event type
- [ ] Deduplication results log channel source of message being deduplicated
- [ ] Manual test: Background sends state via BroadcastChannel → Log shows "[BC]" source
- [ ] Manual test: Background sends state via Port → Log shows "[PORT]" source
- [ ] Manual test: Storage.local.set triggers onChanged → Log shows "[STORAGE]" source
- [ ] Manual test: During ZOMBIE state, verify which channels are actively delivering messages
</acceptance_criteria>

<details>
<summary>Channel Independence</summary>

The three channels operate independently:
- **BroadcastChannel:** Fastest, works cross-tab and frame
- **Port:** Persistent, dedicated to sidebar-background link
- **Storage:** Most reliable, fires on any write from any source

During ZOMBIE, port is broken but BC and storage continue. Unified logging reveals which channels are active.

</details>

---

## Issue #8: Write Retry Success Signals Unclear

**Severity:** MEDIUM | **Impact:** Unclear whether storage writes succeeded after retries  
**File:** `background.js` (writeStateWithVerificationAndRetry, _verifyStorageWrite)

### Problem Summary
When the background writes state to storage, it uses a verification + retry pattern with exponential backoff. The current logging shows retry attempts and failures clearly, but when a write SUCCEEDS (e.g., on attempt 2 of 3), the success is logged but may be lost in the noise of preceding retry logs. There is no clear, distinct success signal that summarizes the entire write lifecycle (e.g., "Write succeeded on attempt 2 of 3 retries").

### Root Cause
The logging pattern logs each retry attempt individually (e.g., "Write pending: retrying", "Attempt 2/3") but does not provide a unified success summary. If a write succeeds on retry, the success message appears after multiple retry messages, making it hard to correlate which attempt actually succeeded or to quickly identify final success state.

### Fix Required
Restructure storage write logging to clearly separate attempt-level detail from overall operation summary. Log the initial write attempt with saveId as a clear starting point. Log each retry with attempt number and which verification method is being used. When a write succeeds (saveId matches in read-back), log a clear success message with the attempt number and total retry count. If all retries fail, log a distinct failure summary. Use consistent prefixes and logging levels to make success/failure immediately visible.

<scope>
**Modify:**
- `background.js` (writeStateWithVerificationAndRetry function logging structure)
- `background.js` (_verifyStorageWrite function logging levels and messages)
- Retry loop logging to provide attempt-level detail vs. final summary

**Do NOT Modify:**
- Retry count or backoff timing
- Verification logic (read-back and compare)
- Storage API calls or error handling flow
</scope>

<acceptance_criteria>
- [ ] Initial write attempt logs "[Background] STORAGE_WRITE_ATTEMPT" with saveId and attempt counter
- [ ] Each retry logs "[Background] STORAGE_WRITE_RETRY [attempt N/max]" with verification method
- [ ] Successful write logs "[Background] STORAGE_WRITE_SUCCESS" with attempt number and total attempts
- [ ] Failed write (all retries exhausted) logs "[Background] STORAGE_WRITE_FINAL_FAILURE" with attempt counts
- [ ] Manual test: Trigger storage write → Verify initial attempt log appears
- [ ] Manual test: Simulate storage write failure → Verify retry logs show progression
- [ ] Manual test: Write succeeds on attempt 2 → Verify success log clearly shows "Success on attempt 2 of 3"
</acceptance_criteria>

<details>
<summary>Write Verification Process</summary>

The write process:
1. Attempt to write state to storage.local via browser.storage.local.set()
2. Read back the value to verify saveId matches
3. If mismatch or read fails, retry with exponential backoff
4. After each attempt, log result (success/retry)
5. If all retries fail, log final failure and escalate

The gap is in step 4: success logs are unclear about which attempt succeeded.

</details>

---

## Issue #9: Adoption Mechanism Lacks Operation Lifecycle Logging

**Severity:** MEDIUM | **Impact:** Impossible to trace adoption operation atomicity or partial failures  
**File:** `background.js` (QuickTabHandler.handleAdoptAction or equivalent)

### Problem Summary
Quick Tab adoption (converting a regular browser tab into a Quick Tab and persisting it) is handled via the QuickTabHandler in `background.js`. However, the adoption flow has no explicit logging that brackets the operation (start, completion, or failure). If adoption fails mid-way (e.g., state mutation succeeds but storage write fails), the error is logged but there is no high-level "adoption failed" signal. Additionally, there is no correlation between adoption initiation and final state persistence, making it hard to verify atomicity.

### Root Cause
The adoption handler is part of the modular QuickTabHandler class, which:
- Handles adoption mutation in a handler method
- Persists the mutation via StateCoordinator or direct storage write
- Logs errors on exception
- Does not provide bracketing logs: "ADOPTION_STARTED", "ADOPTION_COMPLETED", or "ADOPTION_FAILED"

Additionally, there is no explicit logging showing which tab is being adopted, its URL, or the final state snapshot after adoption.

### Fix Required
Add explicit lifecycle logging around adoption operations. Before mutation, log "ADOPTION_STARTED" with the tab ID being adopted and its current state. After successful persistence, log "ADOPTION_COMPLETED" with the new Quick Tab ID and final state. If adoption fails at any point (mutation or persistence), log "ADOPTION_FAILED" with the failure reason and what state changes were made before the failure. This provides end-to-end tracing and makes atomicity issues visible.

<scope>
**Modify:**
- `background.js` (QuickTabHandler adoption handler or adoption-related message routes)
- Entry point to adoption flow (message routing or handler invocation)
- Success/failure paths in adoption

**Do NOT Modify:**
- Adoption mutation logic or state changes
- Storage persistence mechanism
- StateCoordinator or related state management
</scope>

<acceptance_criteria>
- [ ] Adoption initiation logs "[Background] ADOPTION_STARTED" with tab ID, URL, current state snapshot
- [ ] Successful adoption logs "[Background] ADOPTION_COMPLETED" with new Quick Tab ID and final state
- [ ] Failed adoption logs "[Background] ADOPTION_FAILED" with reason (mutation error, persist error, etc.)
- [ ] Logs include correlation ID or tab ID to trace adoption through the system
- [ ] If adoption fails mid-way, log shows what state changes were applied before failure
- [ ] Manual test: Adopt a tab → Verify start and completion logs with consistent correlation IDs
- [ ] Manual test: Simulate storage failure during adoption → Verify failure log shows partial state info
</acceptance_criteria>

<details>
<summary>Adoption Flow Overview</summary>

Adoption typically:
1. Receives adoption request with tab ID (e.g., via content script message)
2. Constructs a Quick Tab object from tab metadata (URL, title, position, etc.)
3. Adds to globalQuickTabState.tabs
4. Persists to storage.local
5. Broadcasts to other tabs
6. Returns success/failure to requester

Lifecycle logging should span all these steps.

</details>

---

## Related Context: Channel Behavior During ZOMBIE State

When the port connection enters ZOMBIE state (background unresponsive, port open), the following behavior occurs:

- **BroadcastChannel:** Continues receiving messages (independent channel)
- **Storage.onChanged:** Continues firing (independent mechanism)
- **Port:** No longer reliable for request/response; may timeout

**Logging Gap:** Currently, there is no explicit log summarizing which channels are ACTIVE when ZOMBIE is detected, and no ongoing monitor showing which channel is delivering each state update during ZOMBIE recovery. This makes it difficult to understand whether the Manager is properly falling back to alternative channels or if state divergence exists across channels during recovery.

**Recommendation for future enhancement:** Add a "channel health summary" log when ZOMBIE state is detected, showing: Port=OFFLINE, BroadcastChannel=ONLINE, Storage=ONLINE. Periodically log during ZOMBIE state which channel delivered the most recent state update.

---

## Summary: Logging Priority by Severity

| Issue | Title | Severity | Effort | Impact |
|-------|-------|----------|--------|--------|
| #1 | Clear All initiation logging | MEDIUM | Low | Enables tracing from user action |
| #2 | Clear All response validation | MEDIUM | Low | Reveals partial failure scenarios |
| #3 | Port state transition context | HIGH | Medium | Critical for connection debugging |
| #4 | Deduplication decision details | MEDIUM | Medium | Clarifies why updates are skipped |
| #5 | Keepalive health monitoring | MEDIUM | Medium | Detects Firefox idle timer workaround failure |
| #6 | Port registry lifecycle | LOW | Low | Detects port leaks over time |
| #7 | Message channel source | MEDIUM | Medium | Critical for multi-channel debugging |
| #8 | Write retry success clarity | MEDIUM | Low | Clarifies storage persistence state |
| #9 | Adoption lifecycle logging | MEDIUM | Low | Traces operation atomicity |

---

**Overall Priority Order:** Address Issues #3 (HIGH) and #7 (MEDIUM channel clarity) first, followed by Issues #1, #2 (Clear All tracing), then #4, #5, #8, #9 (remaining logging enhancements), and finally #6 (registry monitoring).

**Complexity:** All issues are **additive logging enhancements** with no changes to core logic. Implementation complexity is uniformly LOW to MEDIUM across all issues.