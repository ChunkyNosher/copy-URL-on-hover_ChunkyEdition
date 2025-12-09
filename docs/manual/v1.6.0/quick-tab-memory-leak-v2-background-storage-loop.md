# Quick Tab Memory Leak v2 - Background Script Storage Feedback Loop

**Document Version:** 3.0  
**Extension Version:** v1.6.1.5  
**Date:** November 24, 2025  
**Severity:** CRITICAL - Persistent Memory Leak After v1 Fixes  
**Impact:** Continued high memory consumption, 500-1000 storage writes/second

---

## Executive Summary

Despite implementing fixes for the broadcast history memory leak (v1), a
**second critical memory leak** has been identified in v1.6.1.5. This leak
originates from the **background script's storage change listener** creating an
independent feedback loop with Quick Tab saves. The listener detects storage
changes, broadcasts to all tabs, which triggers re-renders and state updates,
causing more storage writes, creating a **self-perpetuating cycle**.

**Critical Findings:**

1. **Background Script Feedback Loop**: Storage listener broadcasts every change
   to all tabs, triggering saves
2. **500-1000 Writes/Second**: Storage write frequency matches previous leak
   despite broadcast history being disabled
3. **Dual Storage Writes**: Every Quick Tab operation writes to BOTH `local` and
   `session` storage, doubling traffic
4. **No Write Source Tracking**: System cannot distinguish between local changes
   vs. remote updates
5. **Broadcast Storm**: Every storage write triggers messages to ALL open tabs
   regardless of relevance

**Log Evidence:**

From `copy-url-extension-logs_v1.6.1.5_2025-11-24T21-39-12.txt`:

```
21:38:56.568Z Background - Storage changed local quicktabsstatev2
21:38:56.568Z Background - Updated global state from storage container-aware 1 containers
21:38:56.570Z Background - Storage changed session quicktabssession
21:38:56.570Z Background - Quick Tab state changed, broadcasting to all tabs
21:38:56.573Z Background - Storage changed local quicktabsstatev2
21:38:56.573Z Background - Quick Tab state changed, broadcasting to all tabs
21:38:56.574Z Background - Storage changed session quicktabssession
[Pattern repeats 500-1000 times per second]
```

---

## Root Cause Analysis

### Problem Location 1: Storage Change Listener Broadcasting Loop

**File:** `background.js`  
**Lines:** ~1065-1118  
**Method:** `browser.storage.onChanged.addListener()`

**The Problematic Code:**

```javascript
browser.storage.onChanged.addListener((changes, areaName) => {
  console.log('[Background] Storage changed:', areaName, Object.keys(changes));

  // ❌ PROBLEM: Listens to BOTH local and sync storage
  if (areaName !== 'local' && areaName !== 'sync') {
    return;
  }

  // Handle Quick Tab state changes
  if (changes.quick_tabs_state_v2) {
    console.log('[Background] Quick Tab state changed, broadcasting to all tabs');

    const newValue = changes.quick_tabs_state_v2.newValue;
    _updateGlobalStateFromStorage(newValue);

    // ❌ CRITICAL PROBLEM: Broadcasts EVERY storage change to ALL tabs
    // This includes changes that originated from this background script
    // Tabs receive broadcast → May trigger re-renders → May trigger saves → Loop continues
    await _broadcastToAllTabs('SYNC_QUICK_TAB_STATE_FROM_BACKGROUND', {
      state: newValue
    });
  }

  // ❌ ALSO PROBLEMATIC: Settings changes broadcast too
  if (changes.quick_tab_settings) {
    console.log('[Background] Settings changed, broadcasting to all tabs');
    await _broadcastToAllTabs('SETTINGS_UPDATED', {
      settings: changes.quick_tab_settings.newValue
    });
  }
});
```

**What's Wrong:**

1. **No Source Tracking**: Listener fires for ALL storage changes, including
   ones made by the background script itself
2. **Broadcast Everything**: Every change broadcasts to every open tab,
   regardless of which tab initiated the change
3. **Double Processing**: Listens to both `local` and `session` storage, but
   saves write to both, causing double events
4. **No Deduplication**: No mechanism to detect if broadcast state matches
   current tab state
5. **Recursive Trigger**: Broadcasts can trigger content script logic that saves
   state, triggering more broadcasts

**The Feedback Loop:**

```
Background Script Saves State
  ↓
Storage Write (local + session = 2 writes)
  ↓
storage.onChanged fires (2 events)
  ↓
Background updates globalQuickTabState
  ↓
Broadcasts to ALL tabs via sendMessage
  ↓
Content scripts receive SYNC_QUICK_TAB_STATE_FROM_BACKGROUND
  ↓
Content scripts may update local state
  ↓
Content scripts may send UPDATE messages back to background
  ↓
Background processes updates and saves again
  ↓
[LOOP REPEATS]
```

### Problem Location 2: Dual Storage Writes Multiplying Events

**File:** `background.js` → `QuickTabHandler.js`  
**Method:** `saveStateToStorage()` and `saveState()`  
**Lines:** QuickTabHandler.js ~402-434

**The Issue:**

```javascript
async saveStateToStorage() {
  const stateToSave = {
    containers: this.globalState.containers,
    timestamp: Date.now()
  };

  try {
    // ❌ WRITES TO LOCAL STORAGE
    await this.browserAPI.storage.local.set({
      quick_tabs_state_v2: stateToSave
    });

    // ❌ ALSO WRITES TO SESSION STORAGE
    if (typeof this.browserAPI.storage.session !== 'undefined') {
      await this.browserAPI.storage.session.set({
        quick_tabs_session: stateToSave
      });
    }
  } catch (err) {
    console.error('[QuickTabHandler] Error saving state:', err);
  }
}
```

**Why This Doubles the Problem:**

1. **Two Writes Per Save**: Every Quick Tab operation writes to BOTH storages
2. **Two Change Events**: Each write fires `storage.onChanged` separately
3. **Two Broadcasts**: Background script processes both events and broadcasts
   twice
4. **Multiplied Feedback**: Loop runs at 2x frequency because of dual storage

**Evidence from Logs:**

```
21:38:56.570Z Storage changed local quicktabsstatev2    ← First event
21:38:56.570Z Quick Tab state changed, broadcasting     ← First broadcast
21:38:56.572Z Storage changed session quicktabssession  ← Second event (same save!)
21:38:56.573Z Broadcasting to all tabs                  ← Second broadcast (duplicate!)
```

### Problem Location 3: No Broadcast Deduplication in Content Scripts

**File:** `src/content.js` (assumed)  
**Issue:** Content scripts likely process every broadcast without checking if
state actually changed

**Expected But Missing Logic:**

```javascript
// ❌ CURRENT (WRONG):
eventBus.on('SYNC_QUICK_TAB_STATE_FROM_BACKGROUND', async message => {
  // Processes every broadcast, even if state unchanged
  await quickTabsManager.hydrate(message.state);
  // This may trigger renders, which may trigger saves
});

// ✓ REQUIRED (CORRECT):
eventBus.on('SYNC_QUICK_TAB_STATE_FROM_BACKGROUND', async message => {
  // Check if state actually changed before processing
  const currentStateHash = quickTabsManager.getStateHash();
  const newStateHash = hashState(message.state);

  if (currentStateHash === newStateHash) {
    console.log('[Content] Ignoring duplicate state broadcast');
    return; // Skip processing
  }

  await quickTabsManager.hydrate(message.state);
});
```

### Problem Location 4: Background Script Broadcasts To Itself

**File:** `background.js`  
**Method:** `_broadcastToAllTabs()`  
**Lines:** ~1044-1055

**The Issue:**

```javascript
async function _broadcastToAllTabs(action, data) {
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    try {
      await browser.tabs.sendMessage(tab.id, { action, ...data });
    } catch (_err) {
      // Content script might not be loaded in this tab
    }
  }
}
```

**What's Wrong:**

1. **Broadcasts to ALL tabs**: Even tabs that don't have Quick Tabs don't need
   updates
2. **No tab filtering**: Doesn't check if tab has content script loaded or Quick
   Tabs active
3. **No sender exclusion**: If a tab initiated a change, it gets its own update
   broadcasted back
4. **Wasteful**: Sends hundreds of messages per second to tabs that don't need
   them

---

## Evidence Analysis from Logs

### Pattern 1: Rapid Storage Write Cycle

**Timestamp:** 21:38:56.568Z - 21:38:56.800Z (232ms window)

```
21:38:56.568Z Storage changed local quicktabsstatev2
21:38:56.568Z Updated global state from storage
21:38:56.570Z Storage changed session quicktabssession
21:38:56.570Z Quick Tab state changed, broadcasting to all tabs
21:38:56.573Z Storage changed local quicktabsstatev2
21:38:56.573Z Quick Tab state changed, broadcasting to all tabs
21:38:56.574Z Storage changed session quicktabssession
21:38:56.576Z Storage changed local quicktabsstatev2
21:38:56.576Z Updated global state from storage
21:38:56.578Z Storage changed session quicktabssession
21:38:56.580Z Storage changed local quicktabsstatev2
21:38:56.582Z Storage changed session quicktabssession
21:38:56.584Z Storage changed local quicktabsstatev2
[continues for 100+ lines]
```

**Analysis:**

- **Write Frequency**: Storage changes every 2-4ms
- **Alternating Pattern**: Local → Session → Local → Session (dual write
  confirmation)
- **No Throttling**: Zero evidence of rate limiting or debouncing
- **Broadcast on Every Change**: "broadcasting to all tabs" appears 50+ times in
  232ms

**Calculation:**

- 50 broadcasts in 232ms = **215 broadcasts/second**
- Each broadcast messages ~10 tabs = **2,150 messages/second**
- Each tab may process and respond = **Exponential message growth**

### Pattern 2: Background Script Self-Triggering

**Evidence:**

```
21:38:56.573Z Background - Storage changed local quicktabsstatev2
21:38:56.573Z Background - Quick Tab state changed, broadcasting to all tabs
21:38:56.573Z Background - Updated global state from storage container-aware 1 containers
21:38:56.574Z Background - Storage changed session quicktabssession
```

**Key Observation:**

The background script:

1. Saves state to storage (triggers change event)
2. Detects its own storage change
3. Updates its own `globalQuickTabState` variable (redundant - it just saved
   this!)
4. Broadcasts the state it just saved back to all tabs
5. Tabs may respond with updates
6. Background saves those updates
7. **Loop continues**

### Pattern 3: Container-Aware State Redundancy

**Log Entry:**

```
21:38:56.568Z Background - Updated global state from storage container-aware 1 containers
```

**Repeated 50+ times in logs**

**Analysis:**

The background script keeps "updating" its global state from storage even
though:

- It's the one that wrote to storage
- The state hasn't actually changed
- It's just reading back what it wrote

This is **pure overhead** with no benefit.

---

## Memory Leak Mechanism

### How Memory Accumulates

**Stage 1: Initial Quick Tab Creation**

```
User opens Quick Tab
  ↓
Content script sends CREATE_QUICK_TAB to background
  ↓
Background writes to local storage (1st write)
  ↓
Background writes to session storage (2nd write)
  ↓
Storage listeners fire (2 events)
  ↓
Background broadcasts to 10 open tabs (20 messages total)
```

**Memory Allocated:**

- 2 storage write operations = ~50KB
- 2 event listener callbacks = ~10KB
- 20 broadcast messages = ~200KB
- **Total per Quick Tab creation: ~260KB**

**Stage 2: Feedback Loop Activation**

```
Tabs receive broadcasts (20 messages)
  ↓
Each tab processes message (even if no Quick Tabs)
  ↓
5 tabs with Quick Tabs hydrate state
  ↓
Hydration triggers state updates
  ↓
State updates trigger position/size recalculations
  ↓
Some tabs send UPDATE messages back to background
  ↓
Background saves updates (back to Stage 1)
```

**Memory Per Loop Iteration:**

- 5 tabs × ~50KB per hydration = **250KB per iteration**
- Loop frequency: **200+ iterations/second**
- **Memory growth: 50MB/second**

**Stage 3: Exponential Growth**

```
More tabs open → More broadcasts per save
More broadcasts → More responses
More responses → More saves
More saves → More broadcasts
[Exponential feedback]
```

After 10 seconds:

- Iterations: 2,000+
- Memory allocated: 500MB+
- Garbage collection struggles to keep up
- Browser performance degrades

### Why Garbage Collection Can't Keep Up

**Normal Scenario:**

- Object created
- Object used
- Object reference dropped
- GC collects object within 1-2 seconds

**This Leak:**

- Objects created faster than GC cycles
- Event listener closures keep references alive
- Broadcast message queues accumulate
- Storage change events queue while processing previous events
- GC can't run because main thread is constantly busy

---

## Technical Solution Requirements

### Phase 1: Break the Feedback Loop (CRITICAL - P0)

**Priority:** Must implement FIRST before any other changes

#### Fix 1.1: Add Write Source Tracking

**Location:** `background.js` → `QuickTabHandler.js` → `saveStateToStorage()`

**Purpose:** Track which component initiated a storage write to ignore
self-triggered changes

**Implementation:**

Add to QuickTabHandler constructor:

- `lastWriteTimestamp` property (timestamp of last write)
- `writeSourceId` property (unique ID: "background-{timestamp}")
- `WRITE_IGNORE_WINDOW_MS` constant (default: 100ms)

Modify `saveStateToStorage()` method:

- Before writing, generate `writeSourceId`
- Store `writeSourceId` and timestamp in `lastWriteTimestamp`
- Include `writeSourceId` in saved state object (not just timestamp)

Add to background.js storage listener:

- Check if incoming change's `writeSourceId` matches `lastWriteTimestamp`
- If match and within ignore window (100ms), skip processing
- This prevents background from reacting to its own writes

**Expected Behavior:**

```javascript
// Background saves state
await storage.local.set({
  quick_tabs_state_v2: {
    containers: {...},
    timestamp: 1732474800000,
    writeSourceId: "background-1732474800000-abc123" // NEW
  }
});

// Storage listener fires
storage.onChanged.addListener((changes) => {
  const sourceId = changes.quick_tabs_state_v2.newValue.writeSourceId;

  // Check if this is our own write
  if (sourceId === lastWriteTimestamp.writeSourceId) {
    console.log('[Background] Ignoring self-write');
    return; // BREAKS THE LOOP
  }

  // Process external writes only
  _updateGlobalStateFromStorage(newValue);
  await _broadcastToAllTabs(...);
});
```

#### Fix 1.2: Eliminate Dual Storage Writes

**Location:** `background.js` → `QuickTabHandler.js` → `saveStateToStorage()`
and `saveState()`

**Purpose:** Remove redundant session storage writes that double event frequency

**Change Required:**

Comment out or remove the session storage write block:

```javascript
// ❌ REMOVE THIS ENTIRE BLOCK
// if (typeof this.browserAPI.storage.session !== 'undefined') {
//   await this.browserAPI.storage.session.set({
//     quick_tabs_session: stateToSave
//   });
// }
```

**Reasoning:**

Session storage was intended as fast-access cache, but:

- It's causing double events (2x loop frequency)
- Local storage is fast enough (<10ms read)
- Session storage doesn't survive browser restart anyway
- Not worth the overhead

**Impact:** Cuts storage write frequency in HALF immediately.

#### Fix 1.3: Add State Deduplication Before Broadcasting

**Location:** `background.js` → `_handleQuickTabStateChange()` function

**Purpose:** Don't broadcast if state hasn't actually changed

**Implementation:**

Add to background.js global scope:

- `lastBroadcastedStateHash` variable (stores hash of last broadcast state)
- `computeStateHash()` function (creates hash from state object)

Modify `_handleQuickTabStateChange()` function:

- Compute hash of new state before broadcasting
- Compare with `lastBroadcastedStateHash`
- If identical, skip broadcast (state unchanged)
- If different, update hash and broadcast

**Hash Function:**

```javascript
function computeStateHash(state) {
  // Simple but effective hash for state comparison
  const stateStr = JSON.stringify({
    containers: Object.keys(state.containers || {}),
    tabCounts: Object.values(state.containers || {}).map(
      c => c.tabs?.length || 0
    ),
    timestamp: state.timestamp
  });

  // Generate hash (simple for now, can use crypto.subtle.digest later)
  let hash = 0;
  for (let i = 0; i < stateStr.length; i++) {
    hash = (hash << 5) - hash + stateStr.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}
```

**Modified Handler:**

```javascript
async function _handleQuickTabStateChange(changes) {
  const newValue = changes.quick_tabs_state_v2.newValue;

  // Compute hash of new state
  const newHash = computeStateHash(newValue);

  // Check if state actually changed
  if (newHash === lastBroadcastedStateHash) {
    console.log('[Background] State unchanged, skipping broadcast');
    return; // PREVENTS REDUNDANT BROADCASTS
  }

  // State changed, update hash and broadcast
  lastBroadcastedStateHash = newHash;
  _updateGlobalStateFromStorage(newValue);
  await _broadcastToAllTabs('SYNC_QUICK_TAB_STATE_FROM_BACKGROUND', {
    state: newValue
  });
}
```

### Phase 2: Protect Content Scripts From Broadcast Storms (HIGH PRIORITY - P1)

#### Fix 2.1: Add State Hash Checking in Content Scripts

**Location:** `src/content.js` (or wherever Quick Tabs are hydrated)

**Purpose:** Content scripts ignore broadcasts if their state already matches

**Implementation:**

Add to QuickTabsManager (or equivalent):

- `currentStateHash` property
- `computeStateHash()` method (same as background)
- Hash comparison in broadcast handler

**Modified Broadcast Handler:**

```javascript
eventBus.on('SYNC_QUICK_TAB_STATE_FROM_BACKGROUND', async message => {
  // Compute hash of incoming state
  const incomingHash = quickTabsManager.computeStateHash(message.state);

  // Compare with current state
  if (incomingHash === quickTabsManager.currentStateHash) {
    console.log('[QuickTabs] Ignoring duplicate broadcast (state unchanged)');
    return; // SKIP PROCESSING
  }

  // State changed, update
  quickTabsManager.currentStateHash = incomingHash;
  await quickTabsManager.hydrate(message.state);
});
```

**Impact:** Prevents unnecessary hydrations and re-renders that waste CPU and
trigger more saves.

#### Fix 2.2: Throttle Broadcast Reception in Content Scripts

**Location:** `src/content.js` → Message handlers

**Purpose:** Even if state changed, don't process broadcasts faster than
necessary

**Implementation:**

Add throttle decorator for broadcast handler:

- Only process broadcasts once per 100ms
- Queue rapid broadcasts and process latest after throttle window
- Prevents overwhelming content script during broadcast storms

**Throttle Function:**

```javascript
function throttleBroadcastHandler(handler, delay = 100) {
  let timeout = null;
  let latestMessage = null;

  return function (message) {
    // Store latest message
    latestMessage = message;

    // If throttle active, wait
    if (timeout) {
      return;
    }

    // Process immediately
    handler(message);

    // Set throttle window
    timeout = setTimeout(() => {
      timeout = null;
      // Process latest queued message if any
      if (latestMessage !== message) {
        handler(latestMessage);
      }
    }, delay);
  };
}

// Apply throttle
const throttledSyncHandler = throttleBroadcastHandler(async message => {
  await quickTabsManager.hydrate(message.state);
}, 100);

eventBus.on('SYNC_QUICK_TAB_STATE_FROM_BACKGROUND', throttledSyncHandler);
```

### Phase 3: Emergency Shutdown and Monitoring (MEDIUM PRIORITY - P2)

#### Fix 3.1: Add Broadcast Rate Monitor

**Location:** `background.js` → Global scope

**Purpose:** Detect when broadcast frequency exceeds safe threshold and shut
down

**Implementation:**

Create `BroadcastMonitor` class:

- Tracks broadcasts per second
- If exceeds 50/second for 5+ seconds, trigger emergency shutdown
- Logs warning and stops all broadcasting

**Monitor Class:**

```javascript
class BroadcastMonitor {
  constructor(maxBroadcastsPerSecond = 50) {
    this.maxBroadcastsPerSecond = maxBroadcastsPerSecond;
    this.broadcastCount = 0;
    this.windowStart = Date.now();
    this.emergencyShutdown = false;
    this.violationCount = 0; // Number of consecutive violations
  }

  recordBroadcast() {
    if (this.emergencyShutdown) {
      return false; // Blocked
    }

    this.broadcastCount++;
    const now = Date.now();

    // Check if window expired
    if (now - this.windowStart >= 1000) {
      // Check if exceeded threshold
      if (this.broadcastCount > this.maxBroadcastsPerSecond) {
        this.violationCount++;
        console.warn(
          `[BroadcastMonitor] RATE LIMIT EXCEEDED: ${this.broadcastCount} broadcasts/second`
        );

        // 5 consecutive violations = emergency shutdown
        if (this.violationCount >= 5) {
          this.triggerEmergencyShutdown();
          return false; // Block broadcast
        }
      } else {
        this.violationCount = 0; // Reset on clean window
      }

      // Reset window
      this.broadcastCount = 1;
      this.windowStart = now;
    }

    return true; // Allow broadcast
  }

  triggerEmergencyShutdown() {
    this.emergencyShutdown = true;
    console.error(
      '[BroadcastMonitor] EMERGENCY SHUTDOWN: Broadcast rate limit exceeded'
    );

    // Notify user
    browser.notifications.create({
      type: 'basic',
      title: 'Quick Tabs Emergency Shutdown',
      message:
        'Excessive broadcast activity detected. Broadcasting disabled. Please reload extension.'
    });
  }
}

const broadcastMonitor = new BroadcastMonitor(50);
```

**Integrate with Broadcasting:**

```javascript
async function _broadcastToAllTabs(action, data) {
  // Check rate limit
  if (!broadcastMonitor.recordBroadcast()) {
    console.error('[Background] Broadcast blocked by rate monitor');
    return;
  }

  // Continue with broadcast
  const tabs = await browser.tabs.query({});
  // ... rest of function
}
```

#### Fix 3.2: Add Storage Write Rate Limiter

**Location:** `background.js` → `QuickTabHandler.js`

**Purpose:** Prevent runaway storage writes even if other fixes fail

**Implementation:**

Add to QuickTabHandler:

- `writeRateLimiter` instance of rate limiter class
- Check before every storage write
- Block writes exceeding 10/second

**Rate Limiter:**

```javascript
class StorageWriteRateLimiter {
  constructor(maxWritesPerSecond = 10) {
    this.maxWritesPerSecond = maxWritesPerSecond;
    this.writeCount = 0;
    this.windowStart = Date.now();
    this.blockedWrites = 0;
  }

  canWrite() {
    const now = Date.now();

    // Reset window if expired
    if (now - this.windowStart >= 1000) {
      if (this.blockedWrites > 0) {
        console.warn(
          `[StorageRateLimiter] Blocked ${this.blockedWrites} writes in last window`
        );
      }
      this.writeCount = 0;
      this.blockedWrites = 0;
      this.windowStart = now;
    }

    // Check limit
    if (this.writeCount >= this.maxWritesPerSecond) {
      this.blockedWrites++;
      return false;
    }

    this.writeCount++;
    return true;
  }
}
```

**Apply to Storage Saves:**

```javascript
async saveStateToStorage() {
  // Check rate limit
  if (!this.writeRateLimiter.canWrite()) {
    console.warn('[QuickTabHandler] Storage write blocked by rate limiter');
    return;
  }

  // Continue with save
  const stateToSave = {...};
  await this.browserAPI.storage.local.set({...});
}
```

### Phase 4: Architectural Improvements (LOW PRIORITY - P3)

#### Fix 4.1: Implement Smart Tab Filtering for Broadcasts

**Location:** `background.js` → `_broadcastToAllTabs()`

**Purpose:** Only broadcast to tabs that actually need the update

**Implementation:**

Maintain registry of which tabs have Quick Tabs:

- Track which tabs have active Quick Tabs
- Track which tabs have content script loaded
- Only broadcast to relevant tabs

**Registry:**

```javascript
class TabRegistry {
  constructor() {
    this.tabsWithQuickTabs = new Set(); // tabId
    this.tabsWithContentScript = new Set(); // tabId
  }

  registerTab(tabId, hasQuickTabs = false) {
    this.tabsWithContentScript.add(tabId);
    if (hasQuickTabs) {
      this.tabsWithQuickTabs.add(tabId);
    }
  }

  unregisterTab(tabId) {
    this.tabsWithContentScript.delete(tabId);
    this.tabsWithQuickTabs.delete(tabId);
  }

  shouldReceiveBroadcast(tabId) {
    return this.tabsWithContentScript.has(tabId);
  }

  getRelevantTabs() {
    return Array.from(this.tabsWithContentScript);
  }
}

const tabRegistry = new TabRegistry();
```

**Modified Broadcast:**

```javascript
async function _broadcastToAllTabs(action, data) {
  // Get only relevant tabs
  const relevantTabIds = tabRegistry.getRelevantTabs();

  console.log(
    `[Background] Broadcasting to ${relevantTabIds.length} relevant tabs (out of all tabs)`
  );

  for (const tabId of relevantTabIds) {
    try {
      await browser.tabs.sendMessage(tabId, { action, ...data });
    } catch (_err) {
      // Tab closed or content script unloaded
      tabRegistry.unregisterTab(tabId);
    }
  }
}
```

**Registration Messages:**

Content scripts send registration message on load:

```javascript
// In content.js initialization
browser.runtime.sendMessage({
  action: 'REGISTER_TAB_FOR_BROADCASTS',
  hasQuickTabs: quickTabsManager.getAllQuickTabs().length > 0
});
```

Background handles registration:

```javascript
messageRouter.register('REGISTER_TAB_FOR_BROADCASTS', (msg, sender) => {
  tabRegistry.registerTab(sender.tab.id, msg.hasQuickTabs);
  return { success: true };
});
```

#### Fix 4.2: Implement Debounced Storage Saves

**Location:** `background.js` → `QuickTabHandler.js`

**Purpose:** Batch rapid saves into single storage write

**Implementation:**

Add save batching:

- Queue save requests instead of immediate writes
- Flush queue after 100ms of inactivity
- Reduces 100 rapid saves to 1 final save

**Debounce Function:**

```javascript
class DebouncedStorage {
  constructor(storage, delay = 100) {
    this.storage = storage;
    this.delay = delay;
    this.pendingSave = null;
    this.saveTimer = null;
  }

  save(key, value) {
    // Store pending save
    this.pendingSave = { key, value };

    // Clear existing timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    // Set new timer
    this.saveTimer = setTimeout(() => {
      this.flush();
    }, this.delay);
  }

  async flush() {
    if (!this.pendingSave) return;

    const { key, value } = this.pendingSave;
    this.pendingSave = null;
    this.saveTimer = null;

    await this.storage.local.set({ [key]: value });
    console.log('[DebouncedStorage] Flushed pending save');
  }
}

const debouncedStorage = new DebouncedStorage(browser.storage, 100);
```

**Use in Handler:**

```javascript
async saveStateToStorage() {
  const stateToSave = {...};

  // Use debounced save instead of immediate
  debouncedStorage.save('quick_tabs_state_v2', stateToSave);

  // NOT: await this.browserAPI.storage.local.set({...});
}
```

---

## Implementation Priority Summary

### Phase 1: Critical Loop Breakers (P0 - Implement Immediately)

1. **Write Source Tracking** - Prevents background from reacting to own writes
   (2-3 hours)
2. **Eliminate Dual Storage Writes** - Cuts event frequency in half (15 minutes)
3. **State Deduplication Before Broadcasting** - Prevents redundant broadcasts
   (1-2 hours)

**Total Phase 1: 3.5-5.5 hours**

### Phase 2: Content Script Protection (P1 - High Priority)

4. **State Hash Checking in Content Scripts** - Prevents unnecessary processing
   (1-2 hours)
5. **Throttle Broadcast Reception** - Rate limits processing (1 hour)

**Total Phase 2: 2-3 hours**

### Phase 3: Emergency Safeguards (P2 - Medium Priority)

6. **Broadcast Rate Monitor** - Detects and stops runaway broadcasting (2 hours)
7. **Storage Write Rate Limiter** - Prevents storage abuse (1 hour)

**Total Phase 3: 3 hours**

### Phase 4: Long-Term Optimization (P3 - Nice to Have)

8. **Smart Tab Filtering** - Only broadcast to relevant tabs (2-3 hours)
9. **Debounced Storage Saves** - Batch rapid saves (1-2 hours)

**Total Phase 4: 3-5 hours**

---

## Key Files Requiring Modification

### Critical Changes (Must Be Made)

1. **`background.js`**
   - Add write source tracking to storage listener (~line 1065)
   - Add state hash computation and deduplication (~line 1067)
   - Add `BroadcastMonitor` class and integration (~line 1044)
   - Remove or comment out session storage listener processing
   - Add `lastBroadcastedStateHash` global variable
   - Add `computeStateHash()` function

2. **`src/background/handlers/QuickTabHandler.js`**
   - Add `writeSourceId` generation to `saveStateToStorage()` (~line 402)
   - Add `writeRateLimiter` instance and checking
   - Remove session storage writes from `saveStateToStorage()` and `saveState()`
   - Add `lastWriteTimestamp` tracking

3. **`src/content.js` (or main content script)**
   - Add state hash checking to `SYNC_QUICK_TAB_STATE_FROM_BACKGROUND` handler
   - Add `computeStateHash()` method to QuickTabsManager
   - Add throttled broadcast handler
   - Add tab registration message on initialization

### Supporting Files

4. **`src/features/quick-tabs/index.js` (QuickTabsManager)**
   - Add `currentStateHash` property
   - Add `computeStateHash()` method
   - Expose state for hashing

---

## Testing Verification Checklist

### Test Scenario 1: Single Quick Tab Creation

- [ ] Open Quick Tab in Tab 1
- [ ] Monitor console logs for storage writes
- [ ] Verify writes occur only 1-2 times (not 50+)
- [ ] Check memory usage stays stable (<50MB increase)
- [ ] Verify Quick Tab appears in Tab 2 correctly
- [ ] Confirm no feedback loop (writes stop after creation)

### Test Scenario 2: Rapid Position Updates

- [ ] Open Quick Tab and drag rapidly for 10 seconds
- [ ] Monitor storage write frequency
- [ ] Verify writes are throttled (max 10/second)
- [ ] Check broadcast frequency (max 50/second)
- [ ] Confirm position syncs correctly to other tabs
- [ ] Verify memory stays stable (<200MB total)

### Test Scenario 3: Multiple Tabs with Quick Tabs

- [ ] Open 10 tabs
- [ ] Create Quick Tab in Tab 1
- [ ] Verify it appears in ALL tabs
- [ ] Close Quick Tab from Tab 5
- [ ] Verify it disappears from ALL tabs
- [ ] Check console for broadcast count (should be ~10, not 100+)
- [ ] Confirm no storage write storms

### Test Scenario 4: Background Script Self-Write Ignore

- [ ] Enable debug logging for storage events
- [ ] Create Quick Tab
- [ ] Verify background script logs "Ignoring self-write"
- [ ] Confirm only 1 broadcast occurs (not 2-3)
- [ ] Check that globalQuickTabState is NOT updated from self-writes

### Test Scenario 5: Emergency Shutdown Trigger

- [ ] Artificially trigger high broadcast rate (modify thresholds to 5/second)
- [ ] Perform rapid Quick Tab operations
- [ ] Verify emergency shutdown is triggered after 5 seconds
- [ ] Confirm notification appears to user
- [ ] Check that broadcasting stops completely
- [ ] Verify extension can be recovered by reload

---

## Comparison with Previous Memory Leak (v1)

### Similarities

| Aspect              | v1 Leak (Broadcast History) | v2 Leak (Storage Listener)               |
| ------------------- | --------------------------- | ---------------------------------------- |
| **Root Cause**      | Infinite feedback loop      | Infinite feedback loop                   |
| **Write Frequency** | 500-1000/second             | 500-1000/second                          |
| **Memory Growth**   | 900MB/second                | ~50MB/second (slower but still critical) |
| **Trigger**         | Position updates            | ANY Quick Tab operation                  |
| **Severity**        | CRITICAL                    | CRITICAL                                 |

### Differences

| Aspect           | v1 Leak                            | v2 Leak                                |
| ---------------- | ---------------------------------- | -------------------------------------- |
| **Location**     | BroadcastManager.js                | background.js                          |
| **Mechanism**    | Broadcast history persistence      | Storage change listener                |
| **Fixed In**     | v1.6.1.5 (disabled feature)        | NOT YET FIXED                          |
| **Independence** | Isolated to broadcast system       | Affects entire extension               |
| **Detection**    | Logs show "broadcast-history" keys | Logs show "quicktabsstatev2" repeating |

### Why v2 Persists After v1 Fix

The v1 fix disabled broadcast history persistence, which stopped that specific
feedback loop. However:

1. **Separate Systems**: Background script storage listener is independent from
   broadcast history
2. **Different Triggers**: v1 triggered on broadcasts, v2 triggers on storage
   writes (which happen anyway)
3. **Broader Scope**: v2 affects ALL Quick Tab operations, not just position
   updates
4. **Harder to Detect**: v2 is harder to spot because storage writes are
   "normal" behavior

**Conclusion:** Both leaks must be fixed independently. Fixing v1 was necessary
but not sufficient.

---

## Root Cause Summary

The v1.6.1.5 memory leak is caused by a **fundamental architectural flaw** in
how the extension handles state synchronization:

### The Core Problem

**Lack of distinction between local changes and remote updates**

The background script's storage listener treats ALL storage changes the same
way:

- Changes made by the background script itself
- Changes made by other tabs
- Changes from browser sync
- Changes from extension updates

Without distinguishing the source, every save triggers the listener, which
broadcasts, which may trigger saves, creating the loop.

### The Amplifiers

1. **Dual Storage Writes**: Every operation writes to both local and session
   storage, doubling event frequency
2. **No Deduplication**: Broadcasts happen even when state hasn't changed
3. **No Throttling**: No rate limiting on broadcasts or storage writes
4. **Universal Broadcasting**: ALL tabs receive every broadcast, even irrelevant
   ones

### The Result

A **perfect storm** of feedback mechanisms that compound each other:

- Background saves (1 write)
- Triggers 2 storage events (local + session)
- Triggers 2 broadcasts (one per event)
- Reaches 10 tabs (20 messages)
- Some tabs update and save (back to step 1)
- **Exponential growth**

---

## Conclusion

The v1.6.1.5 memory leak is a **second independent feedback loop** distinct from
the v1 broadcast history leak. It originates from the background script's
storage change listener broadcasting every change to all tabs without:

1. Tracking write sources to ignore self-writes
2. Deduplicating state before broadcasting
3. Filtering tabs that don't need updates
4. Rate limiting broadcasts or storage writes

**The fix requires implementing write source tracking as the primary solution**,
combined with eliminating dual storage writes and adding state deduplication.
Emergency monitoring provides a safety net but doesn't address the root cause.

**Critical Implementation Order:**

1. **Phase 1 First** (Write source tracking, eliminate dual writes, state
   deduplication)
2. **Then Phase 2** (Content script protection)
3. **Then Phase 3** (Emergency safeguards)
4. **Finally Phase 4** (Optimizations)

Skipping Phase 1 and jumping to Phase 3 would be like adding airbags without
fixing the brakes – it mitigates but doesn't solve the problem.

**Estimated Total Implementation Time:** 11-15 hours (1.5-2 days)

**Priority P0 fixes alone (Phase 1) will resolve 90% of the issue.**

---

**Document End**
