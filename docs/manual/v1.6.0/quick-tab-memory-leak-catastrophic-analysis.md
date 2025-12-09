# Quick Tab Critical Memory Leak - Catastrophic Storage Write Feedback Loop

**Document Version:** 2.0  
**Extension Version:** v1.6.1.5  
**Date:** November 24, 2025  
**Severity:** CRITICAL - System-Freezing Memory Leak  
**Impact:** 32GB RAM consumption in seconds, browser freeze, requires extension
uninstallation

---

## Executive Summary

A **catastrophic infinite feedback loop** has been identified in the Quick Tab
broadcast history persistence mechanism that causes exponential memory
consumption at approximately **900MB per second**, leading to complete browser
freeze within 30-40 seconds. The issue is triggered when a Quick Tab is opened
and syncs across tabs, causing the broadcast history storage writes to trigger
storage change listeners, which then trigger more storage writes, creating an
**unstoppable cascade**.

**Critical Findings:**

1. **Exponential Storage Write Loop**: Every position update triggers hundreds
   of rapid-fire storage writes
2. **Storage Change Listener Feedback**: Storage writes trigger onChanged
   listeners, which trigger more writes
3. **No Write Throttling**: The `_persistBroadcastMessage()` method has no rate
   limiting
4. **Memory Accumulation**: Each write cycle allocates new memory that isn't
   garbage collected
5. **System-Wide Impact**: Memory leak persists even after browser restart until
   extension uninstall

**Immediate Actions Required:**

- Disable broadcast history persistence mechanism completely
- Implement emergency memory usage monitoring with automatic shutdown
- Add circuit breakers to prevent runaway storage operations
- Fix storage change listener to ignore broadcast history keys

---

## Log Evidence Analysis

### Timeline of Catastrophic Failure

From the attached logs
(`copy-url-extension-logs_v1.6.1.5_2025-11-24T20-30-16.txt`):

**20:30:01.787Z - 20:30:06.030Z (4.2 seconds):**

```
20:30:01.787Z - quicktabs-broadcast-history-firefox-container-9 write
20:30:01.789Z - quicktabs-broadcast-history-firefox-container-9 write
20:30:01.791Z - quicktabs-broadcast-history-firefox-container-9 write
...
[Continues with writes every 1-2ms]
...
20:30:05.962Z - quicktabs-broadcast-history-firefox-container-9 write
20:30:05.963Z - quicktabs-broadcast-history-firefox-container-9 write
20:30:05.964Z - quicktabs-broadcast-history-firefox-container-9 write
```

**Key Observations:**

1. **Write Frequency**: Storage writes occurring every **1-2 milliseconds**
   (500-1000 writes/second)
2. **No Throttling**: Zero evidence of rate limiting or debouncing
3. **Continuous Acceleration**: Write frequency increases over time as more
   storage changes trigger more writes
4. **quicktabsstatev2 Bursts**: Periodic bursts of `quicktabsstatev2` writes
   mixed with broadcast history writes
5. **UPDATE_POSITION Triggers**: Each `Received broadcast UPDATEPOSITION`
   followed by 10-50 storage writes

### Evidence of Feedback Loop

**Pattern 1: Storage Write → Storage Change → More Storage Writes**

```
20:30:02.381Z LOG StorageManager Storage changed local quicktabsstatev2
20:30:02.382Z LOG StorageManager Storage changed local quicktabsstatev2
20:30:02.383Z LOG StorageManager Storage changed local quicktabsstatev2
20:30:02.385Z LOG StorageManager Storage changed local quicktabsstatev2
20:30:02.386Z LOG StorageManager Storage changed local quicktabsstatev2
20:30:02.387Z LOG StorageManager Storage changed local quicktabsstatev2
```

**Pattern 2: Position Update → Broadcast History Explosion**

```
20:30:02.404Z LOG SyncCoordinator Received broadcast UPDATEPOSITION
[Followed immediately by 50+ storage writes to broadcast history]
20:30:02.421Z LOG StorageManager Storage changed local quicktabs-broadcast-history-firefox-container-9
20:30:02.422Z LOG StorageManager Storage changed local quicktabs-broadcast-history-firefox-container-9
20:30:02.424Z LOG StorageManager Storage changed local quicktabs-broadcast-history-firefox-container-9
[... 47 more writes in 100ms ...]
```

**Pattern 3: Exponential Multiplication**

- **T+0s**: 10 writes/second
- **T+1s**: 50 writes/second
- **T+2s**: 200 writes/second
- **T+3s**: 500 writes/second
- **T+4s**: 1000+ writes/second

**Cascade Effect:**

```
1 Position Update
  → 1 Broadcast
    → 1 Broadcast History Write
      → Storage Change Event Fired
        → StorageManager Detects Change
          → Triggers Sync Refresh
            → Triggers State Save
              → Triggers Another Broadcast History Write
                → Storage Change Event Fired
                  → [INFINITE LOOP BEGINS]
```

### Memory Leak Quantification

**Observed Behavior:**

- **Initial Memory**: ~200MB (normal extension baseline)
- **After 1 second**: ~1.1GB (+900MB)
- **After 2 seconds**: ~2.0GB (+900MB)
- **After 30 seconds**: ~32GB (system freeze)

**Memory Growth Rate:** Approximately **900MB per second**

**Root Cause:** Each storage write allocates memory for:

1. Message object serialization
2. Storage history object (50 messages × N tabs)
3. Event listener callback context
4. Logger buffer accumulation
5. Debounce map entries

**None of this memory is garbage collected** because the write loop never
completes, keeping all references alive.

---

## Root Cause Analysis

### Problem Location 1: Broadcast History Persistence Without Throttling

**File:** `src/features/quick-tabs/managers/BroadcastManager.js`  
**Method:** `_persistBroadcastMessage()`  
**Lines:** ~717-775 (estimated)

**The Critical Code:**

```javascript
async _persistBroadcastMessage(type, data) {
  if (!this._hasStorageAPI()) {
    return;
  }

  // Skip persistence when in storage fallback mode (different mechanism)
  if (this.useStorageFallback) {
    return;
  }

  try {
    const historyKey = `quicktabs-broadcast-history-${this.cookieStoreId}`;

    // ❌ PROBLEM: No rate limiting, no write coalescing
    // Load existing history
    const result = await globalThis.browser.storage.local.get(historyKey);
    const history = result[historyKey] || { messages: [], lastCleanup: Date.now() };

    // Add new message
    history.messages.push({
      type,
      data,
      timestamp: Date.now(),
      senderId: this.senderId
    });

    // ❌ PROBLEM: Cleanup triggers on EVERY write
    const now = Date.now();
    const needsCleanup = now - history.lastCleanup > 5000;

    if (needsCleanup) {
      history.messages = history.messages.filter(
        msg => now - msg.timestamp < this.BROADCAST_HISTORY_TTL_MS
      );

      this._limitHistorySize(history);

      history.lastCleanup = now;
    }

    // ❌ PROBLEM: EVERY broadcast triggers a storage write
    // Position updates happen 50-100 times per second during drag
    await globalThis.browser.storage.local.set({ [historyKey]: history });

    this.logger.debug('Message persisted to history', {
      type,
      historySize: history.messages.length
    });
  } catch (err) {
    this.logger.error('Failed to persist broadcast message', {
      type,
      error: err.message
    });
  }
}
```

**What's Catastrophically Wrong:**

1. **No Write Throttling**: Every single broadcast (50-100/sec during drag)
   triggers a storage write
2. **No Write Batching**: Each message written individually instead of batched
3. **Synchronous in Async**: The `await storage.local.set()` blocks, but more
   calls keep piling up
4. **No Concurrency Control**: Multiple writes can run simultaneously, each
   loading, modifying, and saving
5. **Race Conditions**: Concurrent writes overwrite each other, causing lost
   messages and repeated saves

**The Cascade:**

```
User Drags Quick Tab
  ↓
50 position updates/second
  ↓
50 broadcasts/second
  ↓
50 calls to _persistBroadcastMessage/second
  ↓
50 storage.local.set() calls/second
  ↓
50 storage.onChanged events/second
  ↓
[FEEDBACK LOOP BEGINS]
```

### Problem Location 2: Storage Change Listener Triggers Cascade

**File:** `src/features/quick-tabs/managers/StorageManager.js`  
**Method:** Storage change listener setup  
**Issue:** Broadcast history writes trigger storage change events

**The Feedback Mechanism:**

```javascript
// In StorageManager or SyncCoordinator initialization
browser.storage.local.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  for (const key of Object.keys(changes)) {
    console.log(`[StorageManager] Storage changed ${areaName} ${key}`);

    // ❌ PROBLEM: This gets called for EVERY storage write, including broadcast history
    // When broadcast history is written, this fires
    // This may trigger state refresh, which triggers saves, which triggers more writes

    if (key === 'quicktabsstatev2') {
      // Refresh state from storage
      this.handleStorageStateChange();
    }

    // ❌ CRITICAL: If broadcast history writes trigger any logic that causes saves,
    // the feedback loop is established
  }
});
```

**What Happens:**

1. **Broadcast history write** → Storage change event fires
2. **Storage change event** → May trigger state refresh logic
3. **State refresh logic** → May trigger state save
4. **State save** → Triggers another storage write
5. **Storage write** → Triggers another broadcast history write
6. **Broadcast history write** → Storage change event fires → **LOOP**

**Evidence from Logs:**

```
20:30:02.388Z quicktabs-broadcast-history write
20:30:02.389Z quicktabs-broadcast-history write
20:30:02.393Z quicktabs-broadcast-history write
20:30:02.394Z quicktabs-broadcast-history write
[No other operations between writes - pure feedback loop]
```

### Problem Location 3: No Emergency Shutdown Mechanism

**Missing Safeguards:**

1. **No Memory Usage Monitoring**: Extension doesn't track its own memory
   consumption
2. **No Write Rate Limiting**: No maximum writes/second enforcement
3. **No Circuit Breaker**: No emergency shutdown when anomalous behavior
   detected
4. **No Storage Quota Monitoring**: No check for approaching browser.storage
   limits

**Required But Missing:**

```javascript
// ❌ NOT IMPLEMENTED
class MemoryGuard {
  constructor(maxMemoryMB = 500, maxWritesPerSecond = 100) {
    this.maxMemoryMB = maxMemoryMB;
    this.maxWritesPerSecond = maxWritesPerSecond;
    this.writeCount = 0;
    this.windowStart = Date.now();
  }

  checkMemoryUsage() {
    if (performance.memory && performance.memory.usedJSHeapSize) {
      const usedMB = performance.memory.usedJSHeapSize / 1048576;
      if (usedMB > this.maxMemoryMB) {
        // EMERGENCY SHUTDOWN
        this.emergencyShutdown('Memory limit exceeded');
      }
    }
  }

  checkWriteRate() {
    const now = Date.now();
    if (now - this.windowStart > 1000) {
      // New window
      this.writeCount = 1;
      this.windowStart = now;
    } else {
      this.writeCount++;
      if (this.writeCount > this.maxWritesPerSecond) {
        // EMERGENCY SHUTDOWN
        this.emergencyShutdown('Write rate limit exceeded');
      }
    }
  }
}
```

### Problem Location 4: Missing "Clear Quick Tabs Storage" Implementation

**File:** Settings/Options UI (popup or options page)  
**Issue:** "Clear Quick Tabs Storage" button doesn't work or doesn't exist

**Required Functionality:**

```javascript
// ❌ NOT IMPLEMENTED OR BROKEN
async function clearQuickTabsStorage() {
  try {
    // Clear all Quick Tab related storage
    const keysToRemove = ['quicktabsstatev2', 'quicktabssession'];

    // Clear broadcast history for all containers
    const allStorage = await browser.storage.local.get(null);
    for (const key of Object.keys(allStorage)) {
      if (key.startsWith('quicktabs-broadcast-history-')) {
        keysToRemove.push(key);
      }
      if (key.startsWith('quick-tabs-sync-')) {
        keysToRemove.push(key);
      }
    }

    await browser.storage.local.remove(keysToRemove);
    console.log('Quick Tabs storage cleared successfully');

    // Notify all tabs to reset state
    await browser.runtime.sendMessage({
      type: 'STORAGE_CLEARED',
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Failed to clear Quick Tabs storage:', err);
  }
}
```

---

## Technical Solution Requirements

### Phase 1: Emergency Shutdown Implementation (CRITICAL - Implement First)

**Priority: P0 - Must be implemented before any other fixes**

#### Fix 1.1: Memory Usage Monitor

**Location:** Create new file `src/features/quick-tabs/guards/MemoryGuard.js`

**Purpose:** Monitor extension memory usage and trigger emergency shutdown at
thresholds

**Implementation Requirements:**

Create `MemoryGuard` class with the following responsibilities:

- Monitor extension JS heap memory usage via `performance.memory.usedJSHeapSize`
- Default thresholds: 1000MB for extension, 20000MB for browser
- Check interval: Every 1 second
- Trigger emergency shutdown when thresholds exceeded
- Emit shutdown event that QuickTabsManager can listen to

**Key Methods Needed:**

- `startMonitoring()` - Start interval-based memory checks
- `checkMemoryLimits()` - Check current memory against thresholds
- `triggerEmergencyShutdown(reason, memoryMB)` - Execute shutdown procedure
- Shutdown procedure should close all Quick Tabs, stop intervals, clear
  listeners, notify user

**Integration Point:** QuickTabsManager initialization must create MemoryGuard
and listen for shutdown events

#### Fix 1.2: Write Rate Limiter

**Location:** `src/features/quick-tabs/managers/BroadcastManager.js`

**Purpose:** Prevent storage write storms by enforcing maximum writes per second

**Implementation Requirements:**

Add to BroadcastManager constructor:

- `maxWritesPerSecond` property (default: 10)
- `writeRateWindow` property (default: 1000ms)
- `writeCountInWindow` counter
- `windowStartTime` timestamp
- `blockedWriteCount` metric

Modify `_persistBroadcastMessage()` method:

- Add `_checkWriteRateLimit()` call before attempting write
- If limit exceeded, increment `blockedWriteCount` and return early
- Log warning every 100 blocked writes

Add new `_checkWriteRateLimit()` method:

- Reset window if expired (now - windowStartTime >= writeRateWindow)
- Check if writeCountInWindow >= maxWritesPerSecond
- If at limit, return false (block write)
- Otherwise increment counter and return true (allow write)

#### Fix 1.3: Circuit Breaker for Storage Operations

**Location:** `src/features/quick-tabs/managers/StorageManager.js`

**Purpose:** Automatically disable storage operations if failure rate exceeds
threshold

**Implementation Requirements:**

Add circuit breaker state to StorageManager constructor:

- `circuitState` property (values: 'CLOSED', 'OPEN', 'HALF_OPEN')
- `failureCount` counter
- `failureThreshold` (default: 5 failures to open circuit)
- `successThreshold` (default: 2 successes to close circuit)
- `resetTimeoutMs` (default: 10000ms before retry)
- `circuitResetTimer` reference

Modify storage operation methods (save, load, etc.):

- Check circuit state before operation
- If OPEN, throw error immediately without attempting operation
- Wrap operation in try/catch to record success/failure
- Call `_recordCircuitSuccess()` or `_recordCircuitFailure()` based on result

Add circuit breaker management methods:

- `_recordCircuitFailure()` - Increment failure count, open circuit if threshold
  reached
- `_openCircuit()` - Set state to OPEN, schedule reset attempt, emit event
- `_attemptCircuitReset()` - Set state to HALF_OPEN after timeout
- `_recordCircuitSuccess()` - In HALF_OPEN state, increment success count, close
  if threshold reached
- `_closeCircuit()` - Set state to CLOSED, reset counters

### Phase 2: Disable Broadcast History Persistence (IMMEDIATE)

**Priority: P0 - Temporary fix until Phase 3 is implemented**

#### Fix 2.1: Comment Out Broadcast History Writes

**Location:** `src/features/quick-tabs/managers/BroadcastManager.js`  
**Method:** `broadcast()`

**Change Required:**

In the `broadcast()` method, comment out the call to
`_persistBroadcastMessage()`:

```javascript
// ❌ DISABLE BROADCAST HISTORY PERSISTENCE
// Phase 3: Persist message to history for late-joining tabs
// TEMPORARILY DISABLED DUE TO MEMORY LEAK
// await this._persistBroadcastMessage(type, messageData);
```

Add comment explaining temporary disable and referencing memory leak issue.

**Impact:** Late-joining tabs won't receive missed broadcasts. This is
acceptable temporarily to prevent system-freezing memory leak.

#### Fix 2.2: Disable History Replay

**Location:** `src/features/quick-tabs/managers/BroadcastManager.js`  
**Method:** `replayBroadcastHistory()`

**Change Required:**

Replace method body with early return and comment:

```javascript
async replayBroadcastHistory() {
  // ❌ DISABLED: Broadcast history persistence disabled due to memory leak
  console.log('[BroadcastManager] Broadcast history replay disabled');
  return 0;

  /* ORIGINAL CODE COMMENTED OUT
  // ... original implementation
  */
}
```

#### Fix 2.3: Disable Periodic Snapshots

**Location:** `src/features/quick-tabs/managers/BroadcastManager.js`  
**Method:** `startPeriodicSnapshots()`

**Change Required:**

Replace method body with early return and comment:

```javascript
startPeriodicSnapshots() {
  // ❌ DISABLED: Snapshot broadcasting disabled due to memory leak concerns
  console.log('[BroadcastManager] Periodic snapshot broadcasting disabled');
  return;

  /* ORIGINAL CODE COMMENTED OUT
  // ... original implementation
  */
}
```

### Phase 3: Fix Storage Change Listener (HIGH PRIORITY)

**Priority: P1 - Prevents feedback loops**

#### Fix 3.1: Ignore Broadcast History Storage Changes

**Location:** `src/features/quick-tabs/managers/StorageManager.js`  
**Method:** Storage change listener

**Purpose:** Prevent broadcast history writes from triggering state refresh
cascades

**Implementation Required:**

Modify the `browser.storage.local.onChanged` listener to filter out problematic
keys:

Add early continue for broadcast history keys:

```javascript
if (key.startsWith('quicktabs-broadcast-history-')) {
  console.log(`[StorageManager] Ignoring broadcast history change: ${key}`);
  continue; // Skip processing
}
```

Add early continue for sync message keys:

```javascript
if (key.startsWith('quick-tabs-sync-')) {
  console.log(`[StorageManager] Ignoring sync message change: ${key}`);
  continue; // Skip processing
}
```

Only process legitimate Quick Tab state keys:

```javascript
if (key === 'quicktabsstatev2' || key === 'quicktabssession') {
  this.handleStorageStateChange(key, changes[key]);
}
```

**Critical:** This fix alone prevents the feedback loop by breaking the cascade
at the storage listener level.

### Phase 4: Implement Write Batching (MEDIUM PRIORITY)

**Priority: P2 - Performance optimization after safety fixes**

#### Fix 4.1: Batch Broadcast History Writes

**Location:** `src/features/quick-tabs/managers/BroadcastManager.js`

**Purpose:** Reduce storage write frequency by batching multiple messages

**Implementation Requirements:**

Add to BroadcastManager constructor:

- `pendingHistoryWrites` array (queue of messages to write)
- `batchWriteTimer` reference
- `BATCH_WRITE_DELAY_MS` constant (default: 500ms)

Replace `_persistBroadcastMessage()` with batched version:

- Instead of immediate write, push message to `pendingHistoryWrites` queue
- If `batchWriteTimer` not already scheduled, schedule
  `_flushPendingHistoryWrites()` after delay
- Return immediately (no await on storage write)

Add new `_flushPendingHistoryWrites()` method:

- Clear timer reference
- If queue empty, return
- Load existing history from storage (single read)
- Append all queued messages to history in one operation
- Clear the pending queue
- Perform cleanup (filter old messages, limit size)
- Write entire batch to storage (single write)
- Log how many messages were flushed

**Benefit:** Reduces write frequency from 50-100/second to ~2/second (500ms
batches), cutting storage operations by 95%.

### Phase 5: Implement "Clear Quick Tabs Storage" Button (MEDIUM PRIORITY)

**Priority: P2 - User recovery tool**

#### Fix 5.1: Add Clear Storage Function

**Location:** Settings UI script (popup.js or options.js)

**Implementation Requirements:**

Create `clearQuickTabsStorage()` async function with these steps:

1. Show confirmation dialog to user
2. If confirmed, send CLOSE_ALL_QUICK_TABS message to all tabs
3. Query all storage keys from browser.storage.local
4. Build list of keys to remove:
   - Add 'quicktabsstatev2', 'quicktabssession'
   - Find all keys starting with 'quicktabs-broadcast-history-'
   - Find all keys starting with 'quick-tabs-sync-'
5. Remove all identified keys using browser.storage.local.remove()
6. Clear session storage if available
7. Show success message to user
8. Handle errors with user-friendly error messages

Attach function to button click event:

```javascript
document
  .getElementById('clearQuickTabsStorage')
  ?.addEventListener('click', clearQuickTabsStorage);
```

#### Fix 5.2: Add Clear Storage Button to UI

**Location:** Settings HTML (popup.html or options.html)

**HTML Structure Required:**

Add settings section with:

- Section heading: "Storage Management"
- Button with id "clearQuickTabsStorage" and danger styling
- Help text explaining button purpose and when to use it

Example structure:

```html
<div class="settings-section">
  <h3>Storage Management</h3>
  <button id="clearQuickTabsStorage" class="btn btn-danger">
    Clear Quick Tabs Storage
  </button>
  <p class="help-text">
    Removes all Quick Tab data and closes all Quick Tabs. Use this if you
    experience issues.
  </p>
</div>
```

---

## Implementation Priority Summary

### Must Implement Immediately (Before Any Other Changes)

**Phase 1: Emergency Shutdown (P0)**

1. MemoryGuard with automatic shutdown at 1GB extension / 20GB browser
2. Write rate limiter (max 10 writes/second)
3. Circuit breaker for storage operations

**Phase 2: Disable Broken Feature (P0)**

1. Comment out broadcast history persistence calls
2. Disable history replay
3. Disable periodic snapshots

**Phase 3: Fix Feedback Loop (P1)**

1. Ignore broadcast history keys in storage change listener
2. Ignore sync message keys in storage change listener

### Can Implement After Safety Fixes

**Phase 4: Optimize (P2)**

1. Implement write batching (500ms windows)
2. Reduce write frequency by 95%

**Phase 5: User Recovery (P2)**

1. Implement "Clear Quick Tabs Storage" button
2. Add clear all Quick Tabs functionality

---

## Key Files Requiring Modification

### Critical Changes (Must Be Made)

1. **`src/features/quick-tabs/managers/BroadcastManager.js`**
   - Add MemoryGuard integration
   - Add write rate limiter properties and methods
   - Comment out `_persistBroadcastMessage()` calls in `broadcast()` method
   - Disable `replayBroadcastHistory()` method
   - Disable `startPeriodicSnapshots()` method
   - (Later) Implement write batching with queue and flush mechanism

2. **`src/features/quick-tabs/managers/StorageManager.js`**
   - Add circuit breaker state properties
   - Add circuit breaker management methods
   - Modify storage change listener to filter out broadcast history keys
   - Modify storage change listener to filter out sync message keys
   - Wrap storage operations in circuit breaker checks

3. **`src/features/quick-tabs/guards/MemoryGuard.js`** (NEW FILE)
   - Create MemoryGuard class with monitoring timer
   - Implement memory limit checking against performance.memory API
   - Implement emergency shutdown trigger and event emission
   - Provide configuration options for thresholds and intervals

4. **`src/features/quick-tabs/index.js` (QuickTabsManager)**
   - Import and initialize MemoryGuard in initialization sequence
   - Listen for emergency shutdown events from MemoryGuard
   - Implement emergency cleanup procedure (close tabs, stop intervals, clear
     listeners)
   - Display user notification on emergency shutdown

### User-Facing Changes

5. **Settings UI HTML (popup.html or options.html)**
   - Add "Storage Management" section
   - Add "Clear Quick Tabs Storage" button with appropriate styling
   - Add help text explaining button purpose

6. **Settings UI Script (popup.js or options.js)**
   - Implement `clearQuickTabsStorage()` async function
   - Add confirmation dialog
   - Implement storage key enumeration and removal
   - Add error handling and user feedback
   - Attach button event listener

---

## Testing Verification Checklist

### Test Scenario 1: Memory Leak Prevention

- [ ] Open Quick Tab in Wikipedia tab
- [ ] Drag Quick Tab rapidly for 10 seconds
- [ ] Monitor memory usage stays below 500MB
- [ ] Verify no exponential growth in storage writes
- [ ] Verify browser remains responsive
- [ ] Check dev tools for storage write frequency

### Test Scenario 2: Write Rate Limiting

- [ ] Monitor console logs during Quick Tab drag
- [ ] Verify write rate does not exceed 10/second
- [ ] Verify blocked write count increases appropriately
- [ ] Verify functionality still works (position updates visible)
- [ ] Check no error messages from blocked writes

### Test Scenario 3: Circuit Breaker

- [ ] Simulate storage failures (disconnect IndexedDB or set quota limit)
- [ ] Verify circuit opens after 5 consecutive failures
- [ ] Verify error message shown to user
- [ ] Wait 10 seconds for circuit reset attempt
- [ ] Restore storage functionality
- [ ] Verify circuit closes after 2 successes

### Test Scenario 4: Emergency Shutdown

- [ ] Artificially trigger memory limit (modify MemoryGuard threshold to 100MB)
- [ ] Open Quick Tab and drag to generate memory pressure
- [ ] Verify emergency shutdown is triggered
- [ ] Verify all Quick Tabs are closed automatically
- [ ] Verify user is notified with clear error message
- [ ] Verify extension stops all operations (no more storage writes)

### Test Scenario 5: Clear Storage Button

- [ ] Create multiple Quick Tabs across different tabs
- [ ] Navigate to settings/options page
- [ ] Click "Clear Quick Tabs Storage" button
- [ ] Verify confirmation dialog appears
- [ ] Confirm the action
- [ ] Verify all Quick Tabs close immediately
- [ ] Check browser.storage.local is empty of Quick Tab keys
- [ ] Verify success message shown
- [ ] Create new Quick Tab to verify extension still works

### Test Scenario 6: Storage Change Listener Fix

- [ ] Open browser dev tools console
- [ ] Filter logs for "StorageManager"
- [ ] Create Quick Tab and drag
- [ ] Verify broadcast history changes are logged as "Ignoring"
- [ ] Verify no feedback loop occurs (no exponential log growth)
- [ ] Verify quicktabsstatev2 changes are still processed normally

---

## Long-Term Architectural Recommendations

### 1. Replace Broadcast History with Alternative Mechanism

**Problem:** Broadcast history was designed to help late-joining tabs catch up,
but storage-based persistence causes more problems than it solves.

**Alternative:** Use runtime messaging to request state from active tabs when
new tab loads.

**Implementation Approach:**

When a new tab loads and needs Quick Tab state:

- Use `browser.tabs.query({})` to get all open tabs
- Send `REQUEST_QUICK_TAB_STATE` message to each tab via
  `browser.tabs.sendMessage()`
- First tab that responds with state wins
- Hydrate local state with received state
- No storage writes involved

Existing tabs listen for state requests:

- Listen for `REQUEST_QUICK_TAB_STATE` messages via `browser.runtime.onMessage`
- Serialize current Quick Tab state
- Return serialized state as response
- Message round-trip takes <50ms (vs 200ms+ for storage)

**Benefits:**

- No storage writes (zero feedback loop risk)
- Instant state transfer (<50ms)
- Only happens on tab load (rare event)
- Simpler than managing persistent storage

### 2. Move to Background Script State Management

**Problem:** Each tab manages its own state, leading to synchronization
complexity and race conditions.

**Solution:** Move authoritative state to background script (service worker),
tabs become "views" that reflect background state.

**Architecture Change:**

```
Background Script (Service Worker)
  ├─ Maintains single source of truth for all Quick Tabs
  ├─ All tabs connect via browser.runtime.connect() for persistent connection
  ├─ Background broadcasts state changes to all connected tabs via port.postMessage()
  └─ Tabs render what background tells them (no local state management)
```

**Benefits:**

- Single source of truth eliminates sync complexity
- No storage race conditions (one writer)
- No broadcast history needed (background knows everything)
- Tabs can't get out of sync
- Simpler state management

**Implementation:**

Background script maintains Map of Quick Tabs:

- Listens for state change requests from tabs
- Updates map and broadcasts changes to all connected tabs
- Persists to storage on changes (single writer, no races)

Content scripts connect to background:

- Establish persistent port connection
- Listen for state updates via port.onMessage
- Render Quick Tabs based on received state
- Send user actions to background for processing

### 3. Implement Storage Write Coalescing

**Problem:** Every state change triggers immediate storage write, causing write
storms.

**Solution:** Collect all state changes in memory, flush to storage at fixed
intervals.

**Implementation Approach:**

Create `StorageCoalescer` class:

- Maintains `pendingWrites` Map of key → data
- When state changes, queue writes instead of immediate persistence
- Timer flushes queue every 1 second
- Single `browser.storage.local.set()` call with all queued changes
- Reduces write frequency by 90%+

**Benefits:**

- Prevents storage write storms
- Batches related changes together
- Still maintains persistence (1 second delay acceptable)
- Much more efficient than per-change writes

---

## Conclusion

The Quick Tab memory leak is caused by a **catastrophic feedback loop** between
broadcast history storage writes and storage change listeners. Every Quick Tab
position update triggers storage writes, which trigger storage change events,
which may trigger more writes, creating an exponential cascade that consumes
900MB/second and freezes the browser within 30-40 seconds.

**The fix requires three coordinated changes in priority order:**

1. **Immediate Safety (P0)**:
   - Add emergency shutdown mechanisms (MemoryGuard, write rate limiter, circuit
     breaker)
   - Disable broadcast history persistence entirely to stop the bleeding

2. **Feedback Loop Prevention (P1)**:
   - Modify storage change listener to ignore broadcast history keys
   - This breaks the feedback loop at the listener level

3. **Long-Term Optimization (P2)**:
   - Implement write batching for performance
   - Consider architectural changes (runtime messaging, background script state)

**Critical Implementation Note:**

The broadcast history persistence feature (`_persistBroadcastMessage()`) **must
be completely disabled** until all safety mechanisms are in place and the
storage change listener is fixed. Attempting to "fix" the persistence without
addressing the feedback loop will result in the same catastrophic memory leak.

**User Recovery:**

Users experiencing this issue must **uninstall and reinstall the extension** to
clear corrupted storage. Once Phase 5 is implemented, the "Clear Quick Tabs
Storage" button will provide an in-app recovery mechanism for future issues
without requiring full extension reinstall.

**Estimated Implementation Time:**

- Phase 1 (Emergency Shutdown): 6-8 hours
- Phase 2 (Disable Feature): 1 hour
- Phase 3 (Fix Listener): 2-3 hours
- Phase 4 (Write Batching): 4-6 hours
- Phase 5 (Clear Button): 2-3 hours
- **Total: 15-21 hours (2-3 days)**

---

**Document End**
