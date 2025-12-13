# Copy-URL-on-Hover: Quick Tabs Feature - Critical Issues & Missing Logging

**Quick Tabs Manager State Persistence & Synchronization Failures**

Extension Version v1.6.3.8-v7 / v1.6.3.8-v8

Date 2025-12-13

<scope>
Multiple state persistence and synchronization failures affecting Quick Tabs creation, destruction, hydration, and storage event handling. Issues span CreateHandler, DestroyHandler, UICoordinator, VisibilityHandler, UpdateHandler, and storage transaction management.
</scope>

---

## Executive Summary

Quick Tabs feature contains four interconnected critical issues causing silent state failures, false transaction timeouts, incomplete cleanup, and race condition masking. All issues impact core user operations (create, minimize, resize, destroy Quick Tabs). Issues were introduced during v1.6.3 refactoring when cross-tab sync was simplified to single-tab model. While each has distinct root cause, all stem from timing mismatches between browser storage API behavior and extension assumptions about listener execution and state ownership validation.

| Issue # | Component | Severity | Root Cause |
|---------|-----------|----------|-----------|
| #1 | Storage listener + fallback polling | CRITICAL | Self-write detection broken, Firefox listener latency masked by polling |
| #2 | DestroyHandler empty write | CRITICAL | Overly strict `forceEmpty` safety check blocks legitimate close-all operations |
| #3 | StorageUtils transaction timeout | HIGH | 500ms threshold incompatible with Firefox's 100-250ms normal listener delay |
| #4 | UICoordinator + CreateHandler hydration | MEDIUM | Async/sync race condition hidden by recovery logic |

---

## Issue #1: Storage Listener Self-Write Detection Broken

**Problem**

When content script writes to `browser.storage.local`, the `storage.onChanged` listener either fires late (250-500ms) or appears not to fire at all in real-time logs. System marks transactions as "TIMEOUT" and "possible infinite loop" (ERROR level), but logs show listener DID fire—just delayed. Fallback polling mechanism (`STORAGEFALLBACKPOLLING`) masks actual listener failures by directly reading storage and reporting success, creating false confidence in broken listener.

Evidence from extension logs:
- Write completes in 22ms (success: true)
- Listener fires 682ms later (STORAGECHANGERECEIVED logged)
- System marks txn as TIMEOUT at 500ms threshold
- Fallback polling reports success independently

**Root Cause**

File `src/features/quick-tabs/storage/` and content.js implement self-write detection logic that either:
1. Filters out legitimate listener events as "self-writes" when they shouldn't be, OR
2. Uses race-condition timing between write completion and listener registration that causes event loss, OR  
3. Fails to match write signature to event, preventing listener from processing its own write

**Issue**

Storage listener registration happens early in content.js, but self-write detection logic doesn't properly account for:
- Firefox's documented 100-250ms listener execution delay after write promise resolves
- Timestamp-based matching between write and listener event
- Cross-tab self-write vs same-tab self-write distinction
- Whether listener should fire for self-writes at all (it should; it just shouldn't re-broadcast)

**Fix Required**

Audit `isSelfWrite()` function and self-write detection logic in storage listener callback. Refactor to:
1. Use strict timestamp matching (write time vs event time, within 50ms window) rather than heuristic detection
2. Ensure listener FIRES and processes self-writes (just doesn't re-broadcast them externally)
3. Account for Firefox's 100-250ms normal listener delay in timeout constants
4. Remove or deprioritize fallback polling that masks real listener failures
5. Distinguish "self-write from this extension" vs "self-write from different tab"

Consider checking how write metadata (transaction ID, timestamp) flows through listener callback and whether event payload contains sufficient context for reliable self-write detection.

---

## Issue #2: DestroyHandler Blocked by Overly Strict `forceEmpty` Safety Check

**Problem**

When user closes all Quick Tabs via UI, DOM elements are removed but storage write fails silently. Quick Tabs disappear from UI but storage retains old state. Page reload restores "deleted" tabs as ghost tabs (data loss appearance). Logs show explicit WARN messages about "forceEmpty required" but no user-facing error.

Evidence from extension logs:
- Last tab destroyed: DOM cleaned, state cleared locally
- Storage write initiates for empty state (tabCount: 0)
- Warning logged: "BLOCKED Empty write rejected forceEmpty required"
- Write never completes; no error shown to user
- Page reload: old Quick Tabs reappear from storage

**Root Cause**

File `src/features/quick-tabs/handlers/DestroyHandler.js` implements anti-corruption check that prevents non-owner tabs from clearing all Quick Tabs. Logic rejects ANY write with empty state (tabCount: 0) unless `forceEmpty: true` flag is explicitly set. However, DestroyHandler never passes this flag when legitimate "close all" operation occurs, so write blocks silently.

Current flow:
1. User closes last Quick Tab → DestroyHandler.handleDestroy()
2. DestroyHandler builds empty state (tabCount: 0)
3. Attempts storage write without `forceEmpty: true`
4. Safety check sees empty write → rejects with warning
5. DOM cleaned but storage untouched
6. Next page load: state reads old tabs from storage

**Issue**

Safety mechanism doesn't distinguish between:
- Tab A accidentally clearing storage thinking it owns everything (should block)
- Tab A intentionally closing all its Quick Tabs after user action (should allow)

Current check is binary: reject all empty writes unless flag present. Missing context awareness for "legitimate close all operation".

**Fix Required**

Refactor anti-corruption safety check to allow empty writes when:
1. **Source is legitimate owner**: Check `originTabId` on each tab in state matches current tab ID
2. **Intent is explicit**: Track whether operation is user-initiated "close all" vs accidental state corruption
3. **Flow is controlled**: Add explicit "CLOSE_ALL" operation type that sets `forceEmpty: true` appropriately

Consider:
- Should DestroyHandler track whether this is intentional close (from UI button) vs accidental (from message)
- Can operation context flow through to storage write layer
- Should `forceEmpty` be set automatically when deleting last tab and state becomes empty
- How to verify current tab owns all tabs in state before allowing empty write

---

## Issue #3: Transaction Timeout Threshold Incompatible with Firefox Listener Latency

**Problem**

System marks transactions as "TIMEOUT" with ERROR severity and "possible infinite loop" message, but listener actually fired (just delayed 250-500ms). Logs show hundreds of false timeout errors that obscure real issues. Threshold is 500ms but Firefox fires listener normally at 100-250ms AFTER write completes.

Evidence from extension logs:
- Write COMPLETE logged at timestamp T
- System checks at T+250ms: "STALE WARNING" logged
- System checks at T+500ms: "TIMEOUT ERROR" logged
- But listener fires at T+682ms and succeeds
- Next write transaction times out similarly

**Root Cause**

File `src/features/quick-tabs/map-transaction-manager.js` or StorageUtils defines `TRANSACTION_TIMEOUT_MS` constant (currently ~500ms). Code monitors for listener fire and fails transaction if listener doesn't fire within threshold. However:

Firefox documented behavior: `browser.storage.local.set()` Promise resolves when transaction completes, but `storage.onChanged` listener fires asynchronously AFTER promise resolution (100-250ms normal delay documented in Bugzilla #1554088).

Current 500ms threshold catches Firefox's normal 250ms listener delay as timeout, treating normal behavior as critical failure.

**Issue**

Assumption "listener fires instantly after write completes" is incorrect for Firefox. Transaction monitoring logic flags successful operations as failures because listener is slower than expected timeout.

**Fix Required**

Replace fixed 500ms timeout with Firefox-aware adaptive approach:
1. **Increase minimum threshold**: Set to 1000ms (1 second) to safely exceed normal 100-250ms Firefox delay
2. **Monitor actual latency**: Track how long listener actually takes to fire on this machine/browser/state
3. **Implement backoff**: First timeout = warning. Subsequent timeouts = error (indicates real problem, not just slow listener)
4. **Log context**: When timeout occurs, include actual elapsed time vs threshold, not just "timeout occurred"
5. **Account for browser state**: High CPU, garbage collection, or other browser work can add 100-300ms beyond normal delay

Consider measuring listener fire times across successful transactions and adjusting threshold based on 95th percentile, not arbitrary constant.

---

## Issue #4: UICoordinator Orphaned Window Recovery Masks Race Condition

**Problem**

During hydration (loading saved state from storage), UICoordinator detects orphaned windows (DOM exists but not in Map) for EVERY Quick Tab being restored. Recovery logic re-adds windows to Map. Pattern repeats consistently on every page load, indicating systematic timing issue during initialization sequence.

Evidence from extension logs during hydration:
- CreateHandler emits 'stateadded' event
- UICoordinator receives event immediately
- UICoordinator performs DOM query and finds element exists
- But element is NOT in UICoordinator's Map yet
- Recovery logic detects orphaned state and re-adds
- Pattern repeats for all hydrated tabs (not rare edge case)

**Root Cause**

Initialization sequencing has async/sync mismatch between CreateHandler and UICoordinator. Expected flow:
1. CreateHandler.create() → DOM element added + state updated locally
2. CreateHandler emits 'stateadded' → UICoordinator listener fires
3. UICoordinator adds to Map
4. Window in both DOM and Map

Actual flow:
1. CreateHandler.create() → DOM element added + emits 'stateadded' IMMEDIATELY
2. UICoordinator listener receives event
3. But UICoordinator's Map.set() is async or deferred
4. Between event receipt and Map insertion = orphaned state window
5. Recovery detects orphaned, manually re-adds to Map
6. No data loss (recovery works) but indicates initialization bug

Recovery logic executes for every hydrated tab consistently, not occasionally, proving this is systemic timing issue not edge case.

**Issue**

- CreateHandler fires event before ensuring window is registered in all maps
- UICoordinator's event listener doesn't guarantee synchronous Map insertion
- Event bus may deliver events asynchronously relative to state updates
- Recovery logic masks underlying race, preventing true fix

**Fix Required**

Refactor hydration initialization for strict sequencing:

1. **Synchronous Map operations**: When CreateHandler creates window, ensure UICoordinator's Map already contains entry BEFORE emitting event
2. **Ensure event fires AFTER state**: Don't emit 'stateadded' until window is in both DOM and all internal maps
3. **Or Promise-chain for async**: If using async operations, use Promise chains to guarantee Map insertion before event emission
4. **Remove recovery as normal path**: Recovery logic should only exist for catastrophic failures, not normal initialization

Consider:
- Can CreateHandler directly call UICoordinator.registerWindow() before emitting event (synchronous registration)
- Should 'stateadded' event only fire after listener adds to Map (deferred event)
- Can event bus guarantee synchronous delivery vs asynchronous delivery
- Should hydration wait for explicit "added to map" confirmation before proceeding

---

## Missing Logging (Diagnostic Gaps)

Several critical code paths lack logging that would enable root cause diagnosis:

### Storage & Transaction Management

- [ ] **Storage write acknowledgment**: Log when `browser.storage.local.set()` Promise resolves vs when listener fires (missing timing data)
- [ ] **Self-write detection process**: Log decision point and reasoning for each listener event (accept/reject as self-write)
- [ ] **Listener registration timing**: Log when listener is attached, first fire, any listener removal/re-attachment
- [ ] **Transaction state machine**: Log state transitions for each transaction (submitted → awaiting listener → completed/timeout)
- [ ] **Storage read validation**: When hydrating, log what's read from storage and validation results before filtering

### Handlers & Persistence

- [ ] **DestroyHandler empty state**: Log forceEmpty flag decision and why write was blocked (missing context for Issue #2)
- [ ] **Checksum computation**: Log how checksums are computed and compared during hydration (helps diagnose Issue #2 silent writes)
- [ ] **Debounce scheduling**: Log when debounce timers are scheduled, canceled, or fired (missing precision timing data)
- [ ] **VisibilityHandler persist timing**: Log when state is persisted and actual duration to storage write

### Initialization & Hydration

- [ ] **Map insertion timing**: Log when UICoordinator adds to Map relative to event receipt (would expose Issue #4 race)
- [ ] **Hydration sequencing**: Log exact order of operations during each hydration step (helps diagnose Issue #4)
- [ ] **Recovery trigger**: Log WHY orphaned window was detected and what recovery did (missing diagnostic detail)
- [ ] **Event listener attachment**: Log when listeners are attached/removed from event buses (would expose timing issues)

### Firefox API Behavior

- [ ] **Actual listener latency**: Sample and log time between write completion and listener fire to diagnose Issue #3 threshold mismatch
- [ ] **Browser storage operations**: Log browser.storage.local API calls with precise timestamps (needed to understand write/listener gap)

---

## Shared Implementation Context

All issues trace to Firefox WebExtension API behavior diverging from extension assumptions:

**Firefox storage.onChanged behavior:**
- Promise returned by `set()` resolves when transaction completes (per Bugzilla #1554088)
- Listener fires AFTER promise resolves (100-250ms normal delay)
- Listener guaranteed to fire IF operation succeeds (no event loss)
- Listener fires for self-writes (extension's own writes)

**Extension assumptions that need updating:**
- Listener fires immediately after write completes (WRONG - adds 100-250ms)
- Listener won't fire for self-writes (UNCLEAR - should fire, just not re-broadcast)
- 500ms timeout is safe margin (WRONG - normal behavior is 250ms+)
- Recovery mechanisms can mask initialization issues (DANGEROUS - prevents seeing real bugs)

**Consistent pattern:** Extension uses recovery/fallback logic that works but hides underlying issues. System appears functional because fallback mechanisms succeed, but root causes remain unaddressed.

---

<acceptancecriteria>

**Issue #1 - Storage Listener Self-Write Detection**
- Listener fires for all successful `storage.local.set()` calls
- Listener events are processed (not silently filtered)
- Listener payload properly matched to originating write transaction
- No false "TIMEOUT" errors in logs (listener delay accounted for)
- Storage.onChanged events fire reliably within 300ms of write completion
- Fallback polling only triggers for genuine listener failures (not normal delay)

**Issue #2 - DestroyHandler Empty Write**
- Empty state (tabCount: 0) successfully persists when last tab is destroyed
- Page reload does NOT restore "deleted" Quick Tabs
- User action (close all) distinguishable from accidental state corruption
- forceEmpty flag set appropriately for intentional close-all operations
- No silent write failures when legitimate operations occur

**Issue #3 - Transaction Timeout Threshold**
- No false "TIMEOUT" or "possible infinite loop" errors in normal operation
- Timeout threshold accounts for Firefox's 100-250ms listener delay
- Actual elapsed time logged when timeout occurs (not just "timeout")
- Threshold adaptive based on observed listener latency or set to safe minimum (1000ms)
- Backoff implemented: first timeout warning, subsequent timeouts error

**Issue #4 - Orphaned Window Race Condition**
- No orphaned windows detected during hydration (recovery logic unnecessary)
- Windows appear in Map before 'stateadded' event listener processes them
- Hydration sequencing strictly ordered with no deferred operations
- Recovery logic only executes for catastrophic failures, not normal flow

**All Issues Together**
- All existing tests pass
- No new ERROR-level logs in normal operations (only expected WARNs)
- Storage operations (create, update, delete, hydrate) complete without timeout errors
- Manual test: create Quick Tab → move → resize → minimize → restore → delete → reload page (all state preserved correctly)

</acceptancecriteria>

---

<details>

<summary>Extended Diagnostic Context - Issue Interaction</summary>

Issues interact and compound:

1. **Issue #1 + #3**: False listener timeouts logged because threshold too low AND listener detection broken. Both must be fixed.

2. **Issue #1 + #2**: Empty write blocked (Issue #2) but fallback polling (Issue #1) never triggers for empty state, creating perfect storm where last tab deletion silently fails.

3. **Issue #3 + #4**: Orphaned window recovery waits for 'stateadded' event, but 500ms timeout expires before Map insertion completes (race condition manifests as timeout false positive).

4. **Issue #2 alone**: Catastrophic because `forceEmpty` check is only way to allow empty writes, but never called—guarantees ghost tabs after close-all.

**Fix order matters**: 
- Issues #1 and #3 should fix together (listener + timeout)
- Issue #2 should fix separately (critical data loss)
- Issue #4 can fix last (recovery already works, just inefficient)

</details>

---

## Priority & Dependencies

**Immediate (Critical - next build):**
1. **Issue #2**: DestroyHandler forceEmpty flag → fixes ghost tabs data loss
2. **Issue #1 + #3**: Storage listener + timeout → fixes false error logs and transaction reliability

**High Priority (next week):**
3. **Issue #4**: Hydration sequencing → improves initialization performance and removes unnecessary recovery calls

**Rationale**: Issues #1 and #2 cause user-visible data loss. Issues #3 and #4 cause logging noise and inefficiency but not immediate data loss (recovery mechanisms work). However, Issues #1 and #3 together obscure real failures, making system appear functional when storage synchronization is broken.

---

## Technical References

**Firefox WebExtension storage.onChanged timing:**
- Mozilla Bugzilla #1554088: Promise resolves before listener fires
- MDN storage.StorageArea.onChanged: Listener guaranteed to fire for successful operations
- Firefox normal listener delay: 100-250ms after promise resolution (varies by system load)

**Current problematic constants:**
- TRANSACTION_TIMEOUT_MS: ~500ms (too aggressive for Firefox)
- Timeout warning threshold: 250ms (fires before Firefox normal delay)

**Key code areas requiring updates:**
- Storage listener registration and event handling (content.js)
- Self-write detection logic (storage event callback)
- Transaction monitoring and timeout detection (map-transaction-manager.js)
- DestroyHandler empty write validation
- UICoordinator Map insertion and 'stateadded' event sequencing
- Hydration initialization order in QuickTabsManager

