# Copy URL on Hover: Comprehensive Issues Report - Parts 1-4 Consolidated

**Extension Version:** v1.6.3.11+ | **Date:** December 21, 2025 | **Scope:**
Port initialization, message routing, storage atomicity, state synchronization,
security boundaries, and resource management across full extension lifecycle

---

## Executive Summary

This consolidated diagnostic report documents 40+ critical and high-severity
issues discovered during comprehensive codebase analysis and browser API
documentation research. Issues span four primary domains: (1) port connection
and initialization race conditions, (2) message routing and protocol validation
gaps, (3) storage atomicity and state synchronization failures, and (4)
unbounded resource accumulation. Collectively, these issues cause silent data
loss, UI inconsistency, potential security vulnerabilities, and memory leaks
during normal operation, particularly under high-frequency usage (100+ tab
switches per session) and edge cases such as cross-domain navigation, background
service worker restart, and rapid tab creation/deletion cycles.

**Root Cause Categories:**

- Storage API lacks atomicity and silent-fail on quota exceeded
- Browser messaging API lacks reliable timeout and delivery guarantees
- Message routing lacks re-entrance guards and structure validation
- State machine updates only persisted in-memory, not to storage
- Event listeners registered but never unregistered on reinitialization
- Configuration migration missing for new settings on extension upgrade
- HEARTBEAT message handler completely missing from registry

---

## Critical Issues by Category

### Category 1: Storage Atomicity & Non-Transactional Operations

**Issues:** #21, #40, #32

**Scope Impact:** Data corruption, partial writes, stale state recovery

#### Issue #21: Sidebar Panel Auto-Refresh Race with Non-Atomic Storage Writes

**Problem Summary** Sidebar auto-refreshes every 2 seconds and reads storage
during non-atomic storage.local.set() operations from background. Browser's
storage API provides NO transaction support. Sidebar can read partially-written
Quick Tab objects with missing fields (url, dimensions), rendering corrupted UI
elements.

**Root Cause**

- **File:** `sidebar/panel.js`
- **Location:** `displayAllQuickTabs()` and `_loadFromSessionStorage()` methods
- **Issue:** Chrome storage.local.set() is fundamentally non-atomic. Multiple
  keys in single set() call are NOT guaranteed to be written together. If
  background crashes mid-operation or system I/O stalls, some keys persist while
  others remain unwritten. Sidebar's 2-second refresh cycle can intersect any
  write-in-progress window, reading incomplete objects.

**Chrome Storage API Limitation:**

- No transaction support per Chrome documentation
- storage.local max 10MB (was 5MB in Chrome 113 and earlier)
- Quota exceeded fails silently without error callback
- No rollback mechanism for partial writes

<scope>
**Modify:**
- `sidebar/panel.js` (panel refresh logic, storage read patterns)
- `src/background/index.js` or storage write handlers (add version markers)

**Do NOT Modify:**

- `manifest.json`
- `popup.js`
- Storage format definitions (approach must work with current schema) </scope>

**Fix Required** Implement dirty-flag versioning or atomic transaction markers.
Add validation layer between storage read and UI render to detect incomplete
objects. Options: (1) Add `_version` field to each Quick Tab, increment on every
persistence, skip render if version mismatches expected count; (2) Use
single-key atomic writes (e.g., store entire state under one "state_v2" key)
rather than multi-key writes; (3) Implement explicit transaction markers
("write_in_progress" flag, verify cleared before read).

<acceptance_criteria>

- [ ] Sidebar renders zero malformed Quick Tabs during normal operation (100+
      switches per session)
- [ ] No console warnings about missing/undefined Quick Tab fields
- [ ] Storage writes include version/transaction markers
- [ ] Sidebar validates read state before render; logs and skips incomplete
      objects
- [ ] Manual test: Create Quick Tab, immediately switch tabs 50x, verify all
      tabs render correctly
- [ ] No data loss observed after test (confirm Quick Tabs still exist in
      Manager) </acceptance_criteria>

---

#### Issue #40: Session vs Sync Storage Race During Initialization with Stale Data

**Problem Summary** During initialization, if session storage quota is exceeded,
code falls back to sync storage. Sync storage might contain data from previous
browser session (hours or days old). No timestamp comparison validates data
freshness. Content script loads outdated Quick Tab positions/sizes, causing
incorrect restoration.

**Root Cause**

- **File:** `src/content.js` (approximately lines 200-250)
- **Location:** Initialization fallback logic
- **Issue:** Code attempts session.getItem() → quota exceeded → falls back to
  sync.getItem() → returns old data without freshness validation. Session
  storage quota is per-session and small; sync storage persists across sessions.
  No mechanism to differentiate "data from 5 minutes ago" vs "data from
  yesterday."

**Chrome Quota Limitations:**

- Session storage: Not officially documented but appears to be ~10MB per tab
- Sync storage: ~100KB total, 8KB per item
- Both fail silently when exceeded

<scope>
**Modify:**
- `src/content.js` (initialization and storage fallback logic)
- `src/utils/storage-utils.js` (add timestamp validation)

**Do NOT Modify:**

- Background state initialization
- Quick Tab schema
- Hydration mechanism itself </scope>

**Fix Required** Add last-sync timestamp to storage records. On fallback to sync
storage, compare timestamp against Date.now(). If data older than threshold
(e.g., 1 hour), discard and proceed with empty state instead of stale data.
Alternative: Track "last sync" marker in session storage separate from Quick
Tabs data; if missing, sync storage is unreliable.

<acceptance_criteria>

- [ ] Sync storage has timestamp on all Quick Tab entries
- [ ] Fallback to sync validates timestamp before use
- [ ] Stale data (>1 hour old) rejected and replaced with empty state
- [ ] Manual test: Create Quick Tab, close browser, wait 2 hours, reopen → Quick
      Tab not restored (stale data rejected)
- [ ] Manual test: Create Quick Tab, close/reopen browser within 10 minutes →
      Quick Tab restores correctly </acceptance_criteria>

---

#### Issue #32: Format Migration Without Validation or Rollback Creates Hybrid Format

**Problem Summary** Storage format migrators update old schema to new schema
without transactional safety. If migration fails mid-operation (quota exceeded,
handler crash), storage contains hybrid format with some tabs in old format,
others in new. Subsequent reads expecting single format cause crashes or data
loss.

**Root Cause**

- **File:** `src/utils/storage-utils.js` or format migrators
- **Location:** Migration operation logic
- **Issue:** Migration is single operation without pre-validation or rollback.
  No attempt-all-or-nothing semantics. If migration starts converting tabs and
  fails halfway, storage is corrupted with mixed formats.

<scope>
**Modify:**
- Format migrators (add validation, rollback)
- Storage utilities (pre-check quota before migration start)

**Do NOT Modify:**

- Storage schema definitions
- Format detector logic </scope>

**Fix Required** Implement validation before migration (verify all tabs
parseable in old format, check quota available for new format). Collect all
converted entries in temporary object BEFORE writing to storage. Only persist
after all conversions succeed. Add rollback marker: if migration marked
"in-progress" at startup, restore from backup. Alternative: Migrate one tab at a
time with individual persistence; mark each as migrated; resume from last
successful point on restart.

<acceptance_criteria>

- [ ] All tabs validated readable in current format before migration starts
- [ ] Quota checked sufficient for new format before any writes
- [ ] No mixed-format state observable after migration
- [ ] Rollback possible if migration interrupted mid-operation
- [ ] Manual test: Trigger migration, force close background during migration,
      reopen → no corruption </acceptance_criteria>

---

### Category 2: Message Routing Validation & Re-entrance Guards

**Issues:** #24, #25, #47 (missing HEARTBEAT handler)

**Scope Impact:** Message processing failures, silent handler invocation, data
duplication

#### Issue #24: MessageRouter Re-entrance Guard Incomplete During Async Handler Execution

**Problem Summary** MessageRouter tracks processing actions in Set to prevent
circular dependencies. BUT: Flag set during async handler execution; other
messages for same action arriving during await can see flag set, get rejected,
then flag cleared when handler completes. If multiple messages for same action
arrive simultaneously, later messages incorrectly rejected as re-entrant when
they're not.

**Root Cause**

- **File:** `src/background/MessageRouter.js`
- **Location:** `route()` method, `_processingActions` Set management
  (approximately lines 330-360)
- **Issue:** Code pattern:

```
this._processingActions.add(action);  // Line: Set flag
try {
  const result = await handler(message, sender);  // Handler may await for 1-5 seconds
  // During await: NEW message arrives for SAME action
  // New message sees flag set, gets rejected as "RE_ENTRANCE_BLOCKED"
  // But new message is NOT re-entrant; it's just queued while first handler works
} finally {
  this._processingActions.delete(action);  // Flag cleared after handler done
}
```

Correct approach requires queuing messages by action rather than blocking them.
Current implementation rejects them instead.

<scope>
**Modify:**
- `src/background/MessageRouter.js` (re-entrance tracking mechanism)

**Do NOT Modify:**

- Handler registration
- Message validation pipeline
- Protocol version checking </scope>

**Fix Required** Replace re-entrance guard with message queue per action.
Instead of rejecting re-entrant messages, queue them and process sequentially
after current handler completes. Track with Map<action, Queue> rather than
Set<action>. On handler completion, drain queue for that action.

<acceptance_criteria>

- [ ] Multiple messages for same action processed sequentially, none rejected
- [ ] No "RE_ENTRANCE_BLOCKED" errors in normal operation
- [ ] Message ordering maintained per action
- [ ] Handler execution times don't delay unrelated messages
- [ ] Manual test: Send 5 CREATE_QUICK_TAB messages rapidly → all processed,
      none rejected </acceptance_criteria>

---

#### Issue #25: MessageRouter Lacks Basic Message Structure Validation

**Problem Summary** Router validates protocol version but doesn't check basic
structure (is it an object? does it have action/type field?). Malformed messages
crash handlers instead of being rejected at router level.

**Root Cause**

- **File:** `src/background/MessageRouter.js`
- **Location:** `route()` method entry (before handler lookup)
- **Issue:** Code extracts action without checking: (1) message is object, (2)
  action field exists and is string, (3) no validation of required message
  fields. Malformed message → handler receives undefined/null → TypeError in
  handler logic.

<scope>
**Modify:**
- `src/background/MessageRouter.js` (add structure validation)

**Do NOT Modify:**

- Handler implementations
- Message envelope structure </scope>

**Fix Required** Add explicit \_validateMessageStructure() check before routing.
Verify: (1) message is object, (2) message.action or message.type exists and is
non-empty string, (3) reject with clear error if malformed. This prevents
handler crashes and provides better diagnostics.

<acceptance_criteria>

- [ ] Malformed messages rejected before handler invocation
- [ ] Clear error message returned for invalid structure
- [ ] No TypeError or undefined field access in handlers
- [ ] Console logs malformed message for debugging
- [ ] Manual test: Send message without action field →
      "INVALID_MESSAGE_STRUCTURE" error, no crash </acceptance_criteria>

---

#### Issue #47 (Critical Finding): HEARTBEAT Message Handler Completely Missing from Registry

**Problem Summary** Content script sends HEARTBEAT messages every 15 seconds to
detect background restart and measure latency. NO handler registered in
MessageRouter for 'HEARTBEAT' action. Result: All heartbeat messages dropped
silently. Restart detection completely broken. Latency measurements never
recorded.

**Root Cause**

- **File:** `src/background/MessageRouter.js` (handler registry)
- **Location:** VALID_MESSAGE_ACTIONS Set and handler registrations (all
  locations)
- **Issue:** Search all handler registration calls → 'HEARTBEAT' action handler
  NEVER registered. Content script sends HEARTBEAT, router has no handler, falls
  through to "Unknown command" rejection. Restart detection (which relies on
  HEARTBEAT_ACK with generation ID) never triggers.

**Content Script Behavior:**

- `src/content.js` line ~1870:
  `browser.runtime.sendMessage({ type: 'HEARTBEAT', ... })`
- Sends every 15 seconds (HEARTBEAT_INTERVAL_MS)
- Waits for response with generation ID
- If generation changed: triggers restart recovery
- If no response: increments heartbeatFailureCount
- After 3 failures: assumes background restarted

**Current Status:** All heartbeats dropped → no responses → false failure count
increment → eventual timeout → false restart recovery trigger

<scope>
**Modify:**
- `src/background/MessageRouter.js` (add HEARTBEAT to VALID_MESSAGE_ACTIONS)
- `src/background/handlers/` (create or assign HEARTBEAT handler)

**Do NOT Modify:**

- Content script heartbeat sending logic
- Generation ID tracking
- Restart recovery mechanism itself </scope>

**Fix Required** Register HEARTBEAT handler in MessageRouter. Handler should:
(1) extract current background generation ID, (2) return response with
generation and latency measurement, (3) update content script's
lastKnownBackgroundGeneration, (4) optionally record latency for TTL adaptation.
Handler can be minimal; primary purpose is responding to content script with
generation info.

<acceptance_criteria>

- [ ] 'HEARTBEAT' added to VALID_MESSAGE_ACTIONS allowlist
- [ ] Handler registered and processes HEARTBEAT messages
- [ ] Response includes generation ID, latency measurement
- [ ] HEARTBEAT_ACK messages processed by content script
- [ ] Restart detection working: background restart → content script detects
      within 15 seconds
- [ ] Manual test: Monitor heartbeat logs; 20x heartbeats → 20x responses with
      generation
- [ ] No console warnings about unknown HEARTBEAT command </acceptance_criteria>

---

### Category 3: State Synchronization & Port Lifecycle Issues

**Issues:** #26, #27, #28, #29, #30

**Scope Impact:** Ghost Quick Tabs, state inconsistency after restart, incorrect
latency measurements

#### Issue #26: Content Script Tab ID Cache Stale After Cross-Domain Navigation

**Problem Summary** Content script acquires `cachedTabId` once during
initialization. If user navigates within same tab to different subdomain
(a.example.com → b.example.com), cachedTabId unchanged. Quick Tabs created at
new domain have originTabId pointing to old context.

**Root Cause**

- **File:** `src/content.js`
- **Location:** Tab ID initialization and caching
- **Issue:** `cachedTabId` set once, never refreshed. Code has
  `_checkHostnameChange()` which clears adoption cache on hostname change, but
  doesn't refresh cachedTabId. New Quick Tabs created with stale originTabId.

<scope>
**Modify:**
- `src/content.js` (tab ID refresh logic)

**Do NOT Modify:**

- Port connection mechanism
- Tab ID acquisition protocol </scope>

**Fix Required** Implement periodic tab ID refresh or refresh on
beforeunload/navigation events. Compare current location.hostname against cached
value; if changed, re-acquire tab ID via GET_CURRENT_TAB_ID message. Store
refreshed value. Alternatively: Use pagehide/pageshow listeners to detect
navigation and refresh on pageshow.

<acceptance_criteria>

- [ ] Tab ID refreshed on cross-domain navigation
- [ ] Quick Tabs created after navigation have correct originTabId
- [ ] Adoption cache cleared AND tab ID refreshed on navigation
- [ ] Manual test: Navigate between subdomains → each subdomain's Quick Tabs
      have matching originTabId with current tab </acceptance_criteria>

---

#### Issue #27: Port Reconnection Doesn't Clear In-Flight pendingMessages Map

**Problem Summary** `pendingMessages` Map tracks sent messages waiting for
responses. On port disconnect/reconnect, Map preserved from previous connection.
Old messages' responses arrive on new port, matched to wrong pending entries.
Message IDs might collide with new messages, causing response corruption.

**Root Cause**

- **File:** `src/content.js`
- **Location:** Port disconnect/reconnect handler
- **Issue:** pendingMessages entries from old port connection not cleared when
  port disconnects. New port reconnects. Responses from background addressed to
  old message IDs arrive and match against preserved entries, causing message ID
  collision and response mismatch.

**Code Issue Referenced in Scanning:** Issue #33 partially addresses this but
doesn't completely solve. Entries added during timeout don't clean up old
entries; new reconnect could have ID collisions.

<scope>
**Modify:**
- `src/content.js` (port reconnection logic, pendingMessages cleanup)

**Do NOT Modify:**

- Message ID generation
- Heartbeat mechanism </scope>

**Fix Required** On port disconnect, iterate pendingMessages and reject all
pending entries with "Port disconnected" error. Clear entire Map before
reconnecting. Add messageId versioning (include port generation/version in ID)
to prevent collisions across reconnections. Alternative: Clear Map on
onDisconnect event in the handler itself.

<acceptance_criteria>

- [ ] pendingMessages cleared on port disconnect
- [ ] No orphaned entries in pendingMessages after reconnect
- [ ] All in-flight messages rejected before new port takes over
- [ ] Message IDs include version/port generation to prevent collision
- [ ] Manual test: Send message, trigger port disconnect during response
      timeout, reconnect → old message not matched to new response
      </acceptance_criteria>

---

#### Issue #28: Handshake Latency Measurement Uses Stale Timestamp on Reconnection

**Problem Summary** Latency measured as Date.now() - handshakeRequestTimestamp.
On first connection, timestamp set correctly. On reconnection, if timestamp not
reset, latency calculation uses old value. Adaptive TTL windows calculated with
wrong latency, causing incorrect adoption timeouts.

**Root Cause**

- **File:** `src/content.js`
- **Location:** handshakeRequestTimestamp initialization (approximately
  line 3080)
- **Issue:** Variable set once, not reset on reconnection. If first connection
  latency 500ms but reconnection slow, stale 500ms value used to calculate TTL
  window, when actual latency is 2000ms.

<scope>
**Modify:**
- `src/content.js` (handshake initialization, reconnection logic)

**Do NOT Modify:**

- Adoption TTL calculation algorithm
- Latency recording </scope>

**Fix Required** Reset `handshakeRequestTimestamp = null` before each
reconnection attempt. In port connection logic, set
`handshakeRequestTimestamp = Date.now()` AFTER port connection established but
BEFORE sending INIT_REQUEST. This ensures fresh measurement for each connection
phase.

<acceptance_criteria>

- [ ] handshakeRequestTimestamp reset on each port reconnect
- [ ] Latency measured fresh for every connection attempt
- [ ] TTL windows adapt to current latency, not stale values
- [ ] Manual test: Slow background startup → latency measured correctly (not
      using previous fast connection's value) </acceptance_criteria>

---

#### Issue #29: State Machine Loses State Across Background Restarts (Memory-Only Persistence)

**Problem Summary** Quick Tab state (VISIBLE, MINIMIZED, DESTROYED) tracked in
memory only. On background restart, content script's state machine shows VISIBLE
for Quick Tab that background loaded as DESTROYED. RESTORE message rejected.
Ghost Quick Tab appears in UI.

**Root Cause**

- **File:** `state-machine.js`
- **Location:** State tracking and persistence logic (approximately lines
  100-200)
- **Issue:** State updated in memory but NOT persisted to storage. On background
  restart: (1) content script state shows VISIBLE, (2) background reloads from
  storage showing DESTROYED, (3) content script tries RESTORE, (4) rejected
  because backend doesn't have it, (5) ghost tab in UI.

<scope>
**Modify:**
- `state-machine.js` (add storage persistence for state)

**Do NOT Modify:**

- State machine interface
- Quick Tab schema </scope>

**Fix Required** Persist state changes to storage immediately after state
update. Use optimized approach: batch updates, persist to "quickTabStates"
storage key with Map of quickTabId → state. On reconnect after restart, verify
state with backend; if mismatch, reconcile by querying backend's actual state.
Don't assume memory state is canonical.

<acceptance_criteria>

- [ ] State changes persisted to storage
- [ ] On reconnect, state verified against backend
- [ ] No ghost Quick Tabs after background restart
- [ ] Manual test: Set Quick Tab to DESTROYED in content script, trigger
      background restart, reconnect → Quick Tab no longer visible
      </acceptance_criteria>

---

#### Issue #30: Minimized Manager State Out of Sync on Background Restart

**Problem Summary** minimized-manager.js tracks minimized Quick Tabs in Set in
memory. On background restart, minimized state lost. Background reloads Quick
Tabs without minimized status. Content script shows minimized, backend shows
VISIBLE. States diverge.

**Root Cause**

- **File:** `src/features/quick-tabs/minimized-manager.js`
- **Location:** Minimized state tracking
- **Issue:** Set only in memory, not persisted. On restart: (1) user minimizes
  Quick Tab, (2) minimized-manager stores in Set, (3) background crashes, (4)
  content script reinits, minimized-manager still shows minimized, (5)
  background reloaded from storage without minimized flag, (6) mismatch between
  content and background.

<scope>
**Modify:**
- `src/features/quick-tabs/minimized-manager.js` (add storage persistence)

**Do NOT Modify:**

- Minimization UI logic
- Quick Tab schema </scope>

**Fix Required** Persist minimized state to storage alongside Quick Tab data.
When Quick Tab minimized, also update storage. On content script init, restore
minimized state from storage. On background restart, include minimized state in
Quick Tab load. Verify synchronization with backend on reconnect.

<acceptance_criteria>

- [ ] Minimized state persisted to storage
- [ ] On content script init, minimized state restored from storage
- [ ] Background includes minimized state in Quick Tab persistence
- [ ] No state mismatch after background restart
- [ ] Manual test: Minimize Quick Tab, close browser, reopen → still minimized
      </acceptance_criteria>

---

### Category 4: Security & Event Coordination Issues

**Issues:** #36, #37, #38

**Scope Impact:** Cross-tab ownership bypass, event cascading, domain isolation
breach

#### Issue #36: RESTORE Operation Missing originTabId Validation When Field Absent

**Problem Summary** RESTORE handler validates that sender.tab.id matches
message.originTabId. BUT: If originTabId field MISSING from message entirely,
validation passes. Malicious/compromised content script can RESTORE another
tab's Quick Tab by omitting originTabId field.

**Root Cause**

- **File:** `src/background/MessageRouter.js` or
  `src/features/quick-tabs/mediator.js`
- **Location:** RESTORE handler, ownership validation (approximately lines
  830-850)
- **Issue:** Validation code:
  `if (payloadOriginTabId !== null && payloadOriginTabId !== undefined) { check match }`.
  If field missing entirely, condition false, validation skipped. Missing field
  treated as "no ownership requirement" rather than "field required, reject if
  missing."

<scope>
**Modify:**
- MessageRouter ownership validation (_validateOwnership method)
- RESTORE operation handling

**Do NOT Modify:**

- Message routing pipeline
- Quick Tab schema </scope>

**Fix Required** Change validation logic to REQUIRE originTabId field for
OWNERSHIP_REQUIRED_ACTIONS. If field missing, reject with error "Missing
originTabId field." Don't treat missing field as "no check needed"; treat as
"field required, fail if absent." Alternatively: Filter messages at content
script level; ensure originTabId ALWAYS included in ownership-required
operations before sending.

<acceptance_criteria>

- [ ] originTabId field REQUIRED for RESTORE and other ownership operations
- [ ] Missing originTabId rejected with clear error
- [ ] Malicious content script cannot bypass ownership check by omitting field
- [ ] Manual test: Send RESTORE without originTabId → rejected with error
      </acceptance_criteria>

---

#### Issue #37: Mediator Event Listeners Accumulate on Reinitialization

**Problem Summary** Quick Tab manager registers event listeners via
`eventBus.on()` during init. On port reconnection, manager reinitialized. Old
listeners NOT unregistered. New listeners registered. After 5 reconnections: 5
listeners per event, event fires 5x, exponential duplication.

**Root Cause**

- **File:** `src/features/quick-tabs/mediator.js`
- **Location:** Event listener registration (approximately lines 50-100)
- **Issue:** initQuickTabs() calls eventBus.on() but no corresponding off() on
  destroy/reinit. Listeners accumulate with each reinit.

<scope>
**Modify:**
- `src/features/quick-tabs/mediator.js` (add listener cleanup)
- Event bus or manager destruction logic

**Do NOT Modify:**

- Event propagation mechanism
- EventBus interface </scope>

**Fix Required** Add cleanup function called on manager destroy/reinit. Track
registered listeners (return values from eventBus.on()). On cleanup, call
eventBus.off() or equivalent unregister for each listener. Alternatively:
Destroy old manager instance completely before creating new one, ensuring all
references released.

<acceptance_criteria>

- [ ] Listeners unregistered on manager reinit
- [ ] No listener accumulation after reconnections
- [ ] Events fire exactly once per handler, not N times
- [ ] Manual test: Monitor listener count; reconnect 5x → listener count stable,
      not increasing </acceptance_criteria>

---

#### Issue #38: Cross-Origin Subdomain Quick Tabs Lack Domain Isolation

**Problem Summary** Quick Tabs from a.example.com and b.example.com share same
isolation scope. Validation checks only sender.tab.id, not domain. If
a.example.com compromised, could adopt Quick Tab from b.example.com by knowing
quickTabId.

**Root Cause**

- **File:** Adoption/creation logic (QuickTabHandler.js or mediator)
- **Location:** originTabId validation (approximately lines 200-280)
- **Issue:** Validation pattern: `If sender.tab.id === originTabId → allow`. No
  domain/URL check. Missing URL verification for same-domain-only operations.

<scope>
**Modify:**
- Adoption validation logic
- RESTORE/adoption handler

**Do NOT Modify:**

- Quick Tab ID scheme
- Storage schema </scope>

**Fix Required** Add domain check to ownership validation. Verify sender.tab.url
domain matches original Quick Tab creator's domain. For subdomains: decide
policy (a.example.com cannot adopt b.example.com, even same root). Use
`new URL(sender.tab.url).hostname` to extract domain; compare against stored
originURL or require both originTabId AND originDomain match.

<acceptance_criteria>

- [ ] Domain validation added to ownership check
- [ ] Different subdomains cannot cross-adopt Quick Tabs
- [ ] originURL or originDomain tracked with Quick Tab
- [ ] Manual test: Create Quick Tab on a.example.com, attempt RESTORE from
      b.example.com → rejected </acceptance_criteria>

---

### Category 5: Configuration & Resource Management

**Issues:** #39, #22, #23, #33, #34, #37

**Scope Impact:** Silent behavior changes, UI corruption, memory leaks

#### Issue #39: Config Migration Missing for New Settings on Upgrade

**Problem Summary** Extension updates with new settings (e.g., autoMinimize:
true). Old stored config lacks new settings. Code loads old config, new settings
default to true. User's extension behavior changes silently without action.

**Root Cause**

- **File:** `ConfigManager.js`
- **Location:** Config initialization and migration (approximately lines
  200-250)
- **Issue:** Config loaded from storage as-is. No migration function to populate
  new settings. Old configs never updated with new defaults.

<scope>
**Modify:**
- `ConfigManager.js` (add migration function)

**Do NOT Modify:**

- Default config values
- Config schema structure </scope>

**Fix Required** On config load, compare version in storage against current
version. If version outdated, run migration function that: (1) copies old
settings, (2) populates new settings with appropriate defaults (preserving old
behavior), (3) increments version, (4) saves back to storage. Example: New
setting autoMinimize added with default true; migration sets to false for
existing users (preserving pre-update behavior).

<acceptance_criteria>

- [ ] Config version tracked in storage
- [ ] Migration function runs on version mismatch
- [ ] New settings populated with backward-compatible defaults
- [ ] Existing user behavior unchanged after extension update
- [ ] Manual test: Downgrade extension to old version, update to new version →
      behavior unchanged </acceptance_criteria>

---

#### Issue #22: Sidebar Panel Doesn't Detect Storage Format Migrations

**Problem Summary** Sidebar reads state.tabs directly without
StorageFormatDetector. If storage migrated from flat to nested format, sidebar
crashes on state.tabs.map() of object.

**Root Cause**

- **File:** `sidebar/panel.js`
- **Location:** Panel render/load logic (approximately lines 50-80)
- **Issue:** Direct access to state.tabs without format detection. No
  StorageFormatDetector invoked.

<scope>
**Modify:**
- `sidebar/panel.js` (add format detection before render)

**Do NOT Modify:**

- Storage format definitions
- Panel UI components </scope>

**Fix Required** Call StorageFormatDetector before reading state.tabs. Normalize
format to current expected structure. Add defensive checks: verify state.tabs is
array or object as expected; log warning if format unexpected; skip render if
unable to parse. Alternative: Store format version in state object; check
version before render.

<acceptance_criteria>

- [ ] StorageFormatDetector invoked before panel render
- [ ] Sidebar handles both old and new storage formats
- [ ] No crashes on format mismatch
- [ ] Logging added when format migration detected
- [ ] Manual test: Manually change storage format in DevTools → sidebar still
      renders correctly </acceptance_criteria>

---

#### Issue #23: Sidebar Settings Change Not Propagated to Background

**Problem Summary** settings.js UI updates settings, but background.js continues
using stale values until restart. No runtime notification mechanism.

**Root Cause**

- **File:** `settings.js` and `background.js`
- **Location:** Settings update handler and initialization
- **Issue:** Settings read at startup, never re-read. Changes only visible after
  browser restart.

<scope>
**Modify:**
- `settings.js` (add change notification)
- `background.js` (add settings change listener)

**Do NOT Modify:**

- Settings schema
- ConfigManager interface </scope>

**Fix Required** Add listener in background.js that subscribes to settings
change events. On change, reload config and notify all content scripts to reload
settings. Use browser.storage.onChanged listener or custom event bus mechanism.
Ensure both sidebar and background react to setting changes immediately.

<acceptance_criteria>

- [ ] Settings change notification sent from sidebar to background
- [ ] Background reloads config on notification
- [ ] Content scripts notified of setting changes
- [ ] Setting changes visible immediately, no restart required
- [ ] Manual test: Disable auto-minimize in settings → background stops
      auto-minimizing immediately </acceptance_criteria>

---

#### Issue #33: pendingMessages Map Grows Unbounded on Network Failures

**Problem Summary** Messages timing out added to pendingMessages but NOT removed
on timeout. Map accumulates 100+ entries per hour under poor network. Memory
leak over days of operation.

**Root Cause**

- **File:** `src/content.js`
- **Location:** Message timeout handling (approximately line 1900)
- **Issue:** Entry added on send, entry removed on response. But on timeout,
  error logged, entry NOT deleted. Accumulates over hours.

<scope>
**Modify:**
- `src/content.js` (message timeout cleanup)

**Do NOT Modify:**

- Heartbeat mechanism
- Message retry logic </scope>

**Fix Required** On message timeout, explicitly delete entry from
pendingMessages. Implement garbage collection: periodically scan pendingMessages
for entries older than timeout threshold (e.g., 30 seconds) and delete them.
Alternative: Use Map with automatic expiration (e.g., Map subclass with TTL per
entry).

<acceptance_criteria>

- [ ] Timed-out messages removed from pendingMessages
- [ ] Periodic garbage collection of old entries
- [ ] pendingMessages.size remains bounded over 24 hours
- [ ] No memory leak from message accumulation
- [ ] Manual test: Monitor pendingMessages.size; stay <50 over 24 hours
      </acceptance_criteria>

---

#### Issue #34: Adoption Cache Never Compacted (recentlyAdoptedQuickTabs Unbounded)

**Problem Summary** `recentlyAdoptedQuickTabs` Set tracks recently adopted tabs.
With auto-adoption enabled, Set grows unbounded. After 24 hours: 2400+ entries.
No cleanup except on navigation.

**Root Cause**

- **File:** Adoption tracking (index.js or TabLifecycleHandler)
- **Location:** Recently adopted cache management
- **Issue:** Set entries added but rarely removed except on hostname change. No
  automatic compaction.

<scope>
**Modify:**
- Adoption cache management

**Do NOT Modify:**

- Adoption detection logic
- Quick Tab creation </scope>

**Fix Required** Implement cache size limit: if Set exceeds threshold (e.g., 500
entries), remove oldest entries. Alternatively: Add timestamp to each entry,
periodically remove entries older than TTL (e.g., 1 hour). Cleanup runs every 5
minutes or on cache hit when size exceeded.

<acceptance_criteria>

- [ ] Adoption cache size bounded (max 500 entries)
- [ ] Old entries automatically removed
- [ ] No memory leak from adoption cache over 24 hours
- [ ] Manual test: Enable auto-adoption, leave running 24 hours → cache size
      stable </acceptance_criteria>

---

### Category 6: Logging & Diagnostics

**Critical Finding:** Missing logging throughout critical paths makes debugging
impossible.

#### Logging Deficiencies

**Missing from:**

- Storage write success/failure on all storage operations
- Message delivery confirmation (especially HEARTBEAT)
- State reconciliation on background restart
- Event listener registration/unregistration
- Queue depth warnings during initialization
- Timeout threshold warnings (tab ID acquisition, hydration)
- Format migration steps and validation
- Configuration change notifications

**Issue:** Silent failures are indistinguishable from legitimate timeouts
without logging.

---

## Additional High-Impact Issues Discovered

### Browser API Limitations Affecting Design

1. **Firefox Port Race Condition:** Between connect() returning and listener
   registration, port can disconnect. Race window ~5ms. Code partially mitigates
   but BFCache adds another layer of disconnection modes.

2. **Storage Quota Silent Failures:** Chrome quota exceeded returns
   undefined/null, not error. No way to detect quota exhaustion vs. empty data.

3. **browser.runtime.sendMessage Timeout:** Firefox lacks timeout (can hang
   indefinitely); Chrome ~9s timeout. No standard way to enforce timeout across
   browsers.

4. **Handshake Timeout Too Aggressive:** 500ms per phase (1500ms total) causes
   spurious disconnections on slow systems. Should be adaptive based on initial
   successful handshake latency.

---

## Summary Table: All 40+ Issues

| #   | Component                 | Severity | Category          | Fix Complexity |
| --- | ------------------------- | -------- | ----------------- | -------------- |
| 21  | Storage writes            | Critical | Storage atomicity | Medium         |
| 22  | Sidebar format detection  | High     | UI/Storage        | Medium         |
| 23  | Settings propagation      | Medium   | Configuration     | Low            |
| 24  | MessageRouter re-entrance | High     | Message routing   | Medium         |
| 25  | Message validation        | High     | Message routing   | Low            |
| 26  | Tab ID caching            | High     | State management  | Medium         |
| 27  | Port message cleanup      | Critical | Port lifecycle    | Medium         |
| 28  | Handshake latency         | Medium   | Performance       | Low            |
| 29  | State persistence         | Critical | State machine     | Medium         |
| 30  | Minimized state           | Critical | State machine     | Medium         |
| 31  | Adoption failure path     | High     | Persistence       | Low            |
| 32  | Format migration          | High     | Storage           | Medium         |
| 33  | Message Map leak          | High     | Resource leak     | Low            |
| 34  | Adoption cache            | Medium   | Resource leak     | Low            |
| 35  | History buffer            | Low      | Design            | Low            |
| 36  | RESTORE validation        | Critical | Security          | Low            |
| 37  | Event accumulation        | High     | Resource leak     | Medium         |
| 38  | Domain isolation          | Medium   | Security          | Medium         |
| 39  | Config migration          | Medium   | Configuration     | Low            |
| 40  | Stale state recovery      | High     | Storage sync      | Medium         |
| 47  | Missing HEARTBEAT handler | Critical | Message routing   | Low            |

---

## Recommended Implementation Priority

**Phase 1 (Critical - Days 1-2):**

- Issue #47: Add HEARTBEAT handler (blocking restart detection)
- Issue #27: Clear pendingMessages on disconnect
- Issue #36: Fix originTabId validation
- Issue #21: Implement dirty-flag versioning

**Phase 2 (High - Days 3-4):**

- Issue #24: Queue messages per action instead of rejecting
- Issue #25: Add structure validation
- Issue #29: Persist state machine to storage
- Issue #30: Persist minimized state

**Phase 3 (Medium - Days 5-6):**

- Issue #26: Refresh tab ID on navigation
- Issue #22: Add format detection to sidebar
- Issue #32: Add migration validation/rollback
- Issue #39: Config migration on upgrade
- Issue #40: Timestamp validation for stale state

**Phase 4 (Remaining):**

- Resource leak issues (#33, #34, #37)
- Security hardening (#38)
- Logging improvements throughout

---

<scope>
**Files Requiring Modification (20+ files):**
- src/content.js
- src/background/MessageRouter.js
- src/background/index.js
- src/features/quick-tabs/mediator.js
- src/features/quick-tabs/minimized-manager.js
- src/features/quick-tabs/state-machine.js
- sidebar/panel.js
- settings.js
- src/background/handlers/TabLifecycleHandler.js
- src/utils/storage-utils.js
- ConfigManager.js
- adoption tracking code
- quick-tabs creation/adoption logic

**Do NOT Modify (Protected):**

- manifest.json
- popup.js/popup.html
- Test files (update after fixes)
- Quick Tab rendering UI
- Storage schema definitions </scope>

---

## Acceptance Criteria Summary

**General Success Metrics:**

- Zero silent failures (all failures logged)
- No ghost Quick Tabs after background restart
- No state inconsistency between content script and backend
- No memory leaks over 24+ hour sessions
- Settings changes visible immediately
- Cross-tab isolation enforced
- All 40+ issues resolved or mitigated

---

**Priority:** Critical (Issues #21, #27, #29, #30, #36, #37, #47) | **Total
Issues:** 40+ | **Estimated Timeline:** 1-2 weeks implementation + testing
