# Copilot Old Architecture Removal Plan

**Document ID:** ARCH-REMOVAL-001  
**Date:** December 14, 2025  
**Target:** Remove 1200-1600 lines of deprecated port-based code  
**Replacement:** Modern `runtime.sendMessage()` + `storage.onChanged` stateless
architecture  
**Estimated Effort:** 20-30 hours  
**Risk Level:** Medium (requires careful state management transition)

---

## OVERVIEW

The codebase currently contains a **hybrid messaging architecture** where:

- ✅ `broadcast-manager.js` uses the new `tabs.sendMessage()` pattern (correct)
- ❌ `content.js` uses the old persistent `runtime.Port` pattern (outdated)
- ❌ `storage-utils.js` has port-dependent message queue logic (issue #15, #16)
- ❌ Background has port registry and reconnection machinery (unnecessary)

**The problem:** This incomplete migration created 20 documented issues
including:

- Promise chaining error contamination (Issue #15 - CRITICAL)
- Circuit breaker off-by-one bug (Issue #16 - HIGH)
- 10-33.5 second initialization blocking (Issue #17 - MEDIUM)
- Complex BFCache zombie handling (200+ lines of code)
- Message queue management (150+ lines of code)
- Port reconnection with exponential backoff (250+ lines of code)

**The solution:** Complete the migration by removing all port-based code and
standardizing on the proven `tabs.sendMessage()` pattern already working in
`broadcast-manager.js`.

---

## ARCHITECTURE TIMELINE

### CURRENT STATE (Hybrid, Broken)

```
content.js port-based:           ❌ BROKEN
  - Persistent connection kept open
  - Complex reconnection logic
  - 10s+ initialization blocking
  - BFCache zombie handling

broadcast-manager.js stateless:   ✅ WORKING
  - Uses tabs.sendMessage()
  - Clean error handling
  - No initialization barrier
  - No BFCache issues
```

### TARGET STATE (Fully Stateless)

```
content.js Promise-based:         ✅ WILL WORK
  - No persistent ports
  - 100-200ms initialization
  - Simple error handling
  - storage.onChanged fallback
  - No BFCache complexity

background messaging stateless:   ✅ WILL WORK
  - Uses tabs.sendMessage()
  - No port registry
  - No connection tracking
  - storage.onChanged as source of truth
```

---

## FILES REQUIRING REMOVAL/REFACTORING

### 1. `src/content.js` (162 KB) - LARGEST REFACTOR

#### Section 1A: Port Lifecycle Management (~550 lines)

**Lines:** ~1050-1600  
**Status:** REMOVE ENTIRELY

**Code to remove:**

```
let backgroundPort = null;
function connectContentToBackground(tabId)
function handleContentPortMessage(message)
function logContentPortLifecycle(event)
Port lifecycle event handlers
```

**What happens to this code:**

- `connectContentToBackground()` → DELETE (ports no longer needed)
- Port message handlers → DELETE (use runtime.sendMessage instead)
- Port lifecycle logging → DELETE (no ports to log)
- The features currently handled by port will use `storage.onChanged` + timeout
  fallback

**Replacement pattern:** Instead of port messages, use Promise-based messaging
with explicit error handling and storage fallback.

---

#### Section 1B: Port Reconnection & Circuit Breaker (~300 lines)

**Lines:** ~950-1050  
**Status:** REMOVE ENTIRELY

**Code to remove:**

```
const PORT_RECONNECT_INITIAL_DELAY_MS
const PORT_RECONNECT_MAX_DELAY_MS
const PORT_RECONNECT_BACKOFF_MULTIPLIER
const PORT_CIRCUIT_BREAKER_THRESHOLD
portReconnectState tracking
_schedulePortReconnect() function
_resetPortReconnectState() function
Exponential backoff logic
```

**Why remove:**

- Exponential backoff no longer needed (Promise timeout instead)
- Circuit breaker logic has off-by-one bug (Issue #16)
- No persistent connections = no reconnection needed

**What it did:** Attempted to reconnect to background script when port
disconnected, with exponential backoff up to 10 seconds. This is now handled by
Promise timeout + retry.

---

#### Section 1C: Initialization Barrier (~250 lines)

**Lines:** ~1700-1950  
**Status:** SIMPLIFY (reduce from ~250 lines to ~20 lines)

**Code to remove/simplify:**

```
const _initializationBarrier = { }
function _logInitializationBarrierState(phase)
async function _fetchTabIdWithTimeout()
async function _fetchTabIdWithRetry()
async function _attemptTabIdFetch()
function _handleTabIdFetchSuccess()

Constants:
TAB_ID_FETCH_TIMEOUT_MS = 10000 → REDUCE TO 2000
TAB_ID_FETCH_MAX_RETRIES = 3
TAB_ID_FETCH_RETRY_DELAY_MS = 500 → REDUCE TO 100
```

**Why simplify:** Current implementation waits 10 seconds to establish port.
With Promise-based messaging, we can just wait for tab ID with 2-3 second
timeout. If it fails, proceed with graceful degradation.

**Key change:** Reduce from 10-33.5 seconds blocking to 2-3 seconds max with
non-blocking initialization.

---

#### Section 1D: Pending Message Queue (~150 lines)

**Lines:** ~600-750  
**Status:** REMOVE ENTIRELY (Issue #5 context, but no longer needed)

**Code to remove:**

```
const _pendingPortMessages = []
const PENDING_MESSAGE_MAX_AGE_MS = 60000
function _queueMessageForPort(message)
function _processPendingPortMessages()
function _sendPendingMessage()
```

**Why remove:**

- Queue only needed because port wasn't ready
- With Promise-based messaging, just await the message
- If connection fails, fallback to storage read (no queue needed)

**What it did:** Queued messages while port was connecting. With stateless
messaging, we just send the message and it either succeeds or we use storage as
fallback.

---

#### Section 1E: BFCache Handling (~300 lines)

**Lines:** ~1000-1300  
**Status:** REMOVE ENTIRELY OR DRAMATICALLY SIMPLIFY

**Code to remove:**

```
function _handleBFCachePageHide(event)
function _handleBFCachePageShow(event)
function _validateAndSyncStateAfterBFCache()
function _handleBFCacheRestore()
function _handleNormalRestore()
function _disconnectPortForBFCache()
function _computeStateChecksum(state)
function _validateHydrationChecksum()
function _resolveStorageConflict()
function _tryGetSessionState()
function _filterSessionOnlyTabs()
const _bfCacheState = { }
```

**Why remove/simplify:**

- BFCache issues only occur with persistent ports
- Stateless messaging doesn't suffer from zombie ports
- storage.onChanged provides eventual consistency anyway
- No need for SessionStorage reconciliation

**What it did:**

1. Explicitly disconnected port on BFCache entry (prevent zombie)
2. On BFCache restore, validated checksum and synced with storage
3. Resolved conflicts between SessionStorage and localStorage
4. Filtered out session-only tabs

With stateless architecture, we don't need this complexity.

**Remaining after removal:** Just basic lifecycle logging if needed.

---

#### Section 1F: Storage Event Ordering & Deduplication (~200 lines)

**Lines:** ~1400-1600  
**Status:** KEEP (core logic) but SIMPLIFY

**Code to review for removal:**

```
KEEP - Issue #2 fixes:
function _validateStorageEventOrdering()
function _updateAppliedOrderingState()
function _detectSelfWrite()
function _checkTimestampMatch()

REVIEW FOR REMOVAL (Issue #18 - dedup window coupling):
const RESTORE_DEDUP_WINDOW_MS = PORT_RECONNECT_MAX_DELAY_MS;
// This is coupled - replace with explicit constant
```

**What needs fixing:**

- `RESTORE_DEDUP_WINDOW_MS` is coupled to `PORT_RECONNECT_MAX_DELAY_MS` (Issue
  #18)
- When we remove `PORT_RECONNECT_MAX_DELAY_MS`, this will break
- **Solution:** Replace with explicit constant (50ms is sufficient for local
  dedup)

---

#### Section 1G: Self-Write Detection Window Math (~100 lines)

**Lines:** ~380-480  
**Status:** FIX (Issue #19 - constant mismatch)

**Code to fix:**

```
const STORAGE_LISTENER_LATENCY_TOLERANCE_MS = 300;
const SELF_WRITE_DETECTION_WINDOW_MS = STORAGE_LISTENER_LATENCY_TOLERANCE_MS;

// But actual code does:
if (timeSinceWrite <= STORAGE_LISTENER_LATENCY_TOLERANCE_MS + 100) {
  // is self-write
}
```

**The problem (Issue #19):** Constant is 300ms but code uses 300 + 100 = 400ms.
They don't match.

**What needs fixing:**

- Change constant to include the +100ms (set to 400)
- OR remove the +100 from code if 300ms is correct
- Make single source of truth

---

### 2. `src/storage/storage-utils.js` (85 KB) - SECOND LARGEST

#### Section 2A: Storage Write Queue (~150 lines)

**Lines:** ~200-350  
**Status:** REMOVE ENTIRELY

**Code to remove:**

```
async function queueStorageWrite(message, options = {})
let pendingWriteCount = 0
if (pendingWriteCount >= CIRCUIT_BREAKER_THRESHOLD) { // Issue #16 off-by-one!
Promise chaining with false return (Issue #15)
```

**Why remove:**

- Queue only needed because port might be busy
- With Promise-based messaging, just await the message
- If background not responding, `storage.onChanged` provides fallback

**What it did:**

- Queued storage write messages if port wasn't connected
- Implemented circuit breaker (with off-by-one bug - Issue #16)
- Handled promise chaining with contaminated false returns (Issue #15)

**Issue #15 problem (Promise chaining contamination):** Catch block returns
false instead of rejecting promise, breaking chain semantics.

**Issue #16 problem (Circuit breaker off-by-one):** Increment happens before
check, creating dead zone.

---

#### Section 2B: Message Queue State Tracking (~50 lines)

**Lines:** ~350-400  
**Status:** REMOVE ENTIRELY

**Code to remove:**

```
let messageQueueSize = 0
let lastQueueFlushTime = 0
function getQueueStatus()
```

**Why:** No more queue, so no need to track queue status.

---

### 3. `src/background/MessageRouter.js` (10 KB)

#### Section 3A: Port Connection Registry (~100 lines)

**Lines:** ~50-150  
**Status:** REMOVE ENTIRELY

**Code to remove:**

```
const portRegistry = new Map()

export function registerPort(tabId, port)
export function getPort(tabId)
export function removePort(tabId)

Port lifecycle tracking:
function onPortConnect(port)
function onPortDisconnect(port)
```

**Why remove:**

- No more ports, so no registry needed
- Use tab.id from sender directly instead

**What it did:** Maintained a registry of all port connections from content
scripts, tracking which tab has which port open. With tabs.sendMessage(), we
don't need this - we just send to the tab directly.

---

### 4. `src/background/broadcast-manager.js` (6 KB)

#### Section 4A: Port Broadcasting (Already mostly correct, just cleanup)

**Lines:** ~50-150  
**Status:** REMOVE PORT FALLBACK

**Code that's working correctly:**

```
async function broadcastStateToAllTabs(state) {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    browser.tabs.sendMessage(tab.id, {...}).catch(() => {
      // Tab not ready - OK, storage.onChanged will sync
    });
  }
}
```

**Code that might exist but should be removed:**

```
// OLD (port fallback - remove):
if (portRegistry.has(tabId)) {
  const port = portRegistry.get(tabId);
  port.postMessage(message);  // PORT FALLBACK - REMOVE THIS
}
```

---

### 5. `src/background/quick-tabs-initialization.js` (11 KB)

#### Section 5A: Port Registration on Content Script Ready

**Lines:** ~100-200  
**Status:** REMOVE PORT REGISTRATION CODE

**Code to remove:**

```
async function handleContentScriptReady(tabId, sender) {
  // Register port when content script connects
  registerPort(tabId, sender.port);  // REMOVE THIS
  ...
}
```

---

## MIGRATION STEPS (DETAILED)

### Phase 1: Constants & Configuration Fixes (Low Risk)

**Time:** 1-2 hours  
**Tasks:**

1. Fix Issue #18 - Decouple dedup window from port reconnect delay
   - Remove: `const RESTORE_DEDUP_WINDOW_MS = PORT_RECONNECT_MAX_DELAY_MS;`
   - Add: `const RESTORE_DEDUP_WINDOW_MS = 50;` (explicit)

2. Fix Issue #19 - Fix self-write detection window mismatch
   - Change constant to 400ms to match actual check
   - OR fix code to use 300ms if that's correct

---

### Phase 2: Remove Port Reconnection Machinery (Medium Risk)

**Time:** 3-4 hours  
**Dependencies:** Phase 1 complete  
**Tasks:**

1. Remove port lifecycle management from content.js
2. Remove all PORT*RECONNECT*\* constants
3. Remove portReconnectState and related tracking
4. Keep port-related event handlers for now (use as template for Promise
   version)

---

### Phase 3: Remove BFCache Complexity (High Risk)

**Time:** 4-5 hours  
**Dependencies:** Phase 2 complete  
**Testing:** Critical - test BFCache enter/restore  
**Tasks:**

1. Remove BFCache-specific handlers
2. Replace with simple state sync
3. Remove checksum validation
4. Remove SessionStorage reconciliation

---

### Phase 4: Remove Initialization Barrier (High Risk)

**Time:** 5-6 hours  
**Dependencies:** Phase 3 complete  
**Testing:** Critical - verify 100-200ms init time  
**Tasks:**

1. Reduce TAB_ID_FETCH_TIMEOUT_MS from 10000 to 2000
2. Remove \_fetchTabIdWithRetry() - use single timeout
3. Simplify initialization to NOT BLOCK on tabId
4. Features initialize with null tabId, update when available

---

### Phase 5: Remove Message Queue (High Risk)

**Time:** 3-4 hours  
**Dependencies:** Phase 4 complete  
**Tasks:**

1. Remove \_pendingPortMessages array
2. Remove queue processing functions
3. Replace with Promise-based error handling

---

### Phase 6: Remove Background Port Registry (Low Risk)

**Time:** 2-3 hours  
**Dependencies:** Phase 5 complete  
**Tasks:**

1. Remove portRegistry from MessageRouter.js
2. Remove registerPort/getPort/removePort functions
3. Remove port connection/disconnection handlers

---

### Phase 7: Update Background Broadcasting (Low Risk)

**Time:** 1-2 hours  
**Dependencies:** Phase 6 complete  
**Tasks:**

1. Review broadcast-manager.js for any port fallback code
2. Remove port-based message sending
3. Keep tabs.sendMessage() as primary

---

### Phase 8: Testing & Verification (Critical)

**Time:** 5-8 hours  
**Tasks:**

1. Test basic Quick Tab creation/minimization/restoration
2. Test cross-tab synchronization via storage.onChanged
3. Test BFCache enter/restore cycles
4. Test initialization time (should be <500ms)
5. Test error recovery
6. Measure performance improvements

---

## VERIFICATION CHECKLIST FOR COPILOT

After removing port code, verify:

- [ ] `let backgroundPort = null;` removed from content.js
- [ ] `connectContentToBackground()` function removed
- [ ] `handleContentPortMessage()` function removed
- [ ] All PORT*RECONNECT*\* constants removed
- [ ] All portReconnectState tracking removed
- [ ] \_schedulePortReconnect() function removed
- [ ] BFCache port disconnection removed
- [ ] BFCache checksum validation simplified/removed
- [ ] Initialization barrier reduce to <2 seconds
- [ ] TAB_ID_FETCH_TIMEOUT_MS reduced to 2000ms
- [ ] \_fetchTabIdWithRetry() simplified or removed
- [ ] Message queue (\_pendingPortMessages) removed
- [ ] \_queueMessageForPort() function removed
- [ ] portRegistry removed from MessageRouter.js
- [ ] registerPort/getPort/removePort functions removed
- [ ] Port registration in quick-tabs-initialization removed
- [ ] Issue #18 fixed (dedup window decoupled)
- [ ] Issue #19 fixed (self-write detection window matches)
- [ ] Issue #15 fixed (promise chaining no longer returns false)
- [ ] Issue #16 fixed (circuit breaker logic removed)
- [ ] No references to `browser.runtime.connect()` remain
- [ ] No references to `port.postMessage()` remain
- [ ] No references to `port.onMessage` remain
- [ ] No references to `port.onDisconnect` remain
- [ ] All new messaging uses `browser.runtime.sendMessage()` with Promise
- [ ] All new messaging uses `browser.tabs.sendMessage()` for broadcasts
- [ ] Error handling uses try/catch with storage fallback
- [ ] storage.onChanged registered as primary sync mechanism
- [ ] BFCache handler simplified (no complex zombie handling)
- [ ] Bundle size reduced by ~50-80KB

---

## EXPECTED IMPROVEMENTS

### Code Metrics

- **Lines removed:** 1200-1600
- **Files simplified:** 4 (content.js, storage-utils.js, MessageRouter.js,
  broadcast-manager.js)
- **Bundle size:** -50-80KB
- **Cyclomatic complexity:** Reduced from 15+ to <8 in key functions

### Performance

- **Initialization time:** 10-33 seconds → 100-200ms (100x improvement!)
- **Port overhead:** Eliminated (no keepalive pings every 25s)
- **Battery drain:** Reduced (no persistent connections)
- **Memory:** -5-10MB per tab (no port objects)

### Reliability

- **Issue #15 fixed:** Promise contamination eliminated
- **Issue #16 fixed:** Circuit breaker off-by-one removed
- **Issue #17 fixed:** Initialization no longer blocks
- **Issue #18 fixed:** Dedup window decoupled
- **Issue #19 fixed:** Self-write window matches constant
- **BFCache bugs:** Eliminated
- **Silent failures:** Reduced

### Maintainability

- **Architecture clarity:** Single pattern
- **Code duplication:** Reduced
- **Testing easier:** Stateless = deterministic
- **DevTools clarity:** No port confusion

---

## REFERENCES

- **Original Issues:** #1-20 from comprehensive analysis
- **Architecture Documents:** implementation-plan.md, architecture-rationale.md
- **Supporting Documents:** architecture_comparison_analysis.md

---

## NOTES FOR COPILOT IMPLEMENTATION

1. **Don't rush BFCache removal:** Highest risk section. Test thoroughly.

2. **Keep storage.onChanged intact:** This is the fallback mechanism.

3. **Verify Promise error handling:** New code uses try/catch with storage
   fallback.

4. **Test with slow connections:** Use 2G throttling to verify timeout handling.

5. **Check for coupling before removing:** Search all references before deleting
   constants.

6. **Measure bundle size:** Verify 50-80KB reduction achieved.

7. **Performance test before/after:** Measure initialization on slow devices.

8. **Update tests:** Adapt existing tests to new architecture.

---

**Document prepared for GitHub Copilot Coding Agent implementation phase.**
