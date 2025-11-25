# Quick Tabs Manager Panel UI Not Updating

**Date:** November 25, 2025  
**Extension Version:** v1.6.2.0  
**Issue:** Opening, closing, and minimizing Quick Tabs doesn't update the Manager Panel in real-time  
**Root Cause:** Panel updates only from storage polling, not from real-time state events

---

## 🎯 Problem Summary

**User Experience:**
- Open Quick Tabs Manager Panel (Ctrl+Alt+Z)
- Create, minimize, or close Quick Tabs
- **Panel statistics and tab list DO NOT update automatically**
- Must close and reopen panel to see changes

**Expected Behavior:**
- Panel should update immediately when Quick Tabs are created, minimized, or closed
- Tab count should increment/decrement in real-time
- Minimized tabs should move to "minimized" section instantly
- Closed tabs should disappear from list immediately

**Actual Behavior:**
- Panel only updates every 2 seconds (from polling interval)
- Panel reads from `browser.storage.sync` instead of live state
- No event listeners for Quick Tab state changes
- Counts and lists are stale until next poll

---

## 🔍 Root Cause Analysis

### How Panel Currently Updates

**From `panel.js` - PanelManager.open():**
```javascript
open() {
  // ...
  this.contentManager.updateContent();
  
  // Start auto-refresh - POLLING ONLY
  if (!this.updateInterval) {
    this.updateInterval = setInterval(() => {
      this.contentManager.updateContent();  // ← Only mechanism
    }, 2000);  // ← Every 2 seconds
  }
}
```

**From `PanelContentManager.js` - updateContent():**
```javascript
async updateContent() {
  if (!this.panel || !this.isOpen) return;
  
  // Fetch from STORAGE, not live state
  const quickTabsState = await this._fetchQuickTabsFromStorage();
  
  // Extract tabs from storage
  const currentContainerTabs = currentContainerState?.tabs || [];
  
  // Update statistics
  this._updateStatistics(currentContainerTabs.length, latestTimestamp);
  
  // Render tabs
  this._renderContainerSection(currentContainerState, containerInfo);
}
```

**From `PanelContentManager.js` - _fetchQuickTabsFromStorage():**
```javascript
async _fetchQuickTabsFromStorage() {
  try {
    // ❌ READS FROM STORAGE, NOT LIVE STATE
    const result = await browser.storage.sync.get('quick_tabs_state_v2');
    return state.containers || state;
  } catch (err) {
    console.error('[PanelContentManager] Error loading Quick Tabs:', err);
    return null;
  }
}
```

### The Critical Missing Piece

**Panel updates are completely disconnected from Quick Tab state events:**

```
User creates Quick Tab
    ↓
CreateHandler.create() → StateManager.add()
    ↓
StateManager emits 'state:added' event
    ↓
❌ Panel NEVER hears this event
    ↓
Panel continues polling storage every 2 seconds
    ↓
Eventually storage updates
    ↓
Panel sees update on next poll (up to 2 second delay)
```

**Same problem for minimize and close:**

```
User minimizes Quick Tab
    ↓
VisibilityHandler.handleMinimize() → StateManager.update()
    ↓
StateManager emits 'state:updated' event
    ↓
❌ Panel NEVER hears this event
    ↓
MinimizedManager.add() called
    ↓
❌ Panel NEVER queries MinimizedManager
    ↓
Panel continues polling storage
    ↓
Panel sees update on next poll (up to 2 second delay)
```

**Close operation:**

```
User closes Quick Tab
    ↓
DestroyHandler.handleDestroy() → StateManager.delete()
    ↓
StateManager emits 'state:deleted' event
    ↓
❌ Panel NEVER hears this event
    ↓
Panel continues polling storage
    ↓
Panel sees update on next poll (up to 2 second delay)
```

---

## 📊 Evidence from Code Analysis

### 1. Panel Has NO Event Listeners for State Changes

**From `PanelContentManager.js` - setupEventListeners():**
```javascript
setupEventListeners() {
  // Close button
  const closeBtn = this.panel.querySelector('.panel-close');
  closeBtn.addEventListener('click', closeBtnHandler);
  
  // Close Minimized button
  const closeMinimizedBtn = this.panel.querySelector('#panel-closeMinimized');
  closeMinimizedBtn.addEventListener('click', closeMinimizedHandler);
  
  // Close All button
  const closeAllBtn = this.panel.querySelector('#panel-closeAll');
  closeAllBtn.addEventListener('click', closeAllHandler);
  
  // Delegated listener for Quick Tab item actions
  const containersList = this.panel.querySelector('#panel-containersList');
  containersList.addEventListener('click', actionHandler);
  
  // ❌ NO LISTENERS FOR:
  // - 'state:added' (new Quick Tab created)
  // - 'state:updated' (Quick Tab minimized/restored)
  // - 'state:deleted' (Quick Tab closed)
  // - 'storage:changed' (cross-tab sync)
}
```

### 2. Panel Doesn't Have Access to EventBus

**From `PanelContentManager.js` - constructor:**
```javascript
constructor(panelElement, dependencies) {
  this.panel = panelElement;
  this.uiBuilder = dependencies.uiBuilder;
  this.stateManager = dependencies.stateManager;  // ❌ NOT the EventBus-connected StateManager
  this.quickTabsManager = dependencies.quickTabsManager;
  this.currentContainerId = dependencies.currentContainerId;
  
  // ❌ NO eventBus reference
  // ❌ NO way to listen to state events
}
```

**From `panel.js` - PanelManager._initializeControllers():**
```javascript
_initializeControllers() {
  // ...
  
  // Content manager
  this.contentManager = new PanelContentManager(this.panel, {
    uiBuilder: this.uiBuilder,
    stateManager: this.stateManager,  // ❌ PanelStateManager (for panel position)
    quickTabsManager: this.quickTabsManager,
    currentContainerId: this.currentContainerId
    
    // ❌ NOT PASSED:
    // - internalEventBus (from QuickTabsManager)
    // - StateManager (the one that emits events)
  });
}
```

**Critical issue:** Panel gets `PanelStateManager` (manages panel position/size), NOT the `StateManager` that tracks Quick Tab state and emits events.

### 3. Panel Updates Only Query MinimizedManager Count

**Panel NEVER accesses MinimizedManager directly.**

**From logs - No connection to MinimizedManager:**
```
[MinimizedManager] Added minimized tab: qt-xxx
← Panel never hears this

[MinimizedManager] Removed minimized tab: qt-xxx
← Panel never hears this
```

**Panel calculates minimized count from storage:**
```javascript
// PanelContentManager.updateContent()
const minimizedTabs = currentContainerTabs.filter(t => t.minimized);
// ← Counts from storage data, not MinimizedManager.getCount()
```

### 4. Panel Statistics Calculation

**From `PanelContentManager.js` - _updateStatistics():**
```javascript
_updateStatistics(tabCount, timestamp) {
  const totalTabsEl = this.panel.querySelector('#panel-totalTabs');
  const lastSyncEl = this.panel.querySelector('#panel-lastSync');
  
  if (totalTabsEl) {
    totalTabsEl.textContent = `${tabCount} Quick Tab${tabCount !== 1 ? 's' : ''}`;
    // ← Uses tabCount from storage fetch, not live StateManager.count()
  }
  
  if (lastSyncEl) {
    if (timestamp > 0) {
      const date = new Date(timestamp);
      lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
      // ← Shows storage timestamp, not real-time
    }
  }
}
```

**Panel should query:**
- `QuickTabsManager.state.count()` for total tabs
- `QuickTabsManager.minimizedManager.getCount()` for minimized tabs
- Live state instead of storage

---

## 🛠️ Solution: Add Real-Time Event Listeners

### Solution 1: Pass EventBus to PanelContentManager

**Where:** `src/features/quick-tabs/panel.js` - `_initializeControllers()`

**Change:**

```javascript
_initializeControllers() {
  // ...
  
  // Content manager - ADD eventBus and live StateManager
  this.contentManager = new PanelContentManager(this.panel, {
    uiBuilder: this.uiBuilder,
    stateManager: this.stateManager,  // Panel position manager (keep)
    quickTabsManager: this.quickTabsManager,
    currentContainerId: this.currentContainerId,
    
    // NEW: Add these
    eventBus: this.quickTabsManager.internalEventBus,  // For state events
    liveStateManager: this.quickTabsManager.state,      // For live queries
    minimizedManager: this.quickTabsManager.minimizedManager  // For minimized count
  });
}
```

### Solution 2: Add Event Listeners in PanelContentManager

**Where:** `src/features/quick-tabs/panel/PanelContentManager.js`

**Add to constructor:**

```javascript
constructor(panelElement, dependencies) {
  this.panel = panelElement;
  this.uiBuilder = dependencies.uiBuilder;
  this.panelStateManager = dependencies.stateManager;  // Rename for clarity
  this.quickTabsManager = dependencies.quickTabsManager;
  this.currentContainerId = dependencies.currentContainerId;
  
  // NEW: Store event bus and managers
  this.eventBus = dependencies.eventBus;
  this.liveStateManager = dependencies.liveStateManager;
  this.minimizedManager = dependencies.minimizedManager;
  
  this.eventListeners = [];
  this.isOpen = false;
  this.containerAPI = getContainerAPI();
}
```

**Add new method - setupStateListeners():**

```javascript
/**
 * Setup listeners for Quick Tab state events
 * Called when panel opens
 */
setupStateListeners() {
  if (!this.eventBus) {
    console.warn('[PanelContentManager] No eventBus - cannot listen to state events');
    return;
  }
  
  // Listen for Quick Tab created
  this.eventBus.on('state:added', ({ quickTab }) => {
    console.log('[PanelContentManager] Quick Tab added:', quickTab.id);
    if (this.isOpen) {
      this.updateContent();  // Refresh panel
    }
  });
  
  // Listen for Quick Tab updated (minimize/restore/position change)
  this.eventBus.on('state:updated', ({ quickTab }) => {
    console.log('[PanelContentManager] Quick Tab updated:', quickTab.id);
    if (this.isOpen) {
      this.updateContent();  // Refresh panel
    }
  });
  
  // Listen for Quick Tab deleted (closed)
  this.eventBus.on('state:deleted', ({ id }) => {
    console.log('[PanelContentManager] Quick Tab deleted:', id);
    if (this.isOpen) {
      this.updateContent();  // Refresh panel
    }
  });
  
  console.log('[PanelContentManager] State event listeners setup');
}
```

**Update setupEventListeners():**

```javascript
setupEventListeners() {
  // Existing UI event listeners (close buttons, etc.)
  // ...existing code...
  
  // NEW: Setup state event listeners
  this.setupStateListeners();
  
  console.log('[PanelContentManager] All event listeners setup');
}
```

### Solution 3: Query Live State Instead of Storage

**Where:** `src/features/quick-tabs/panel/PanelContentManager.js` - `updateContent()`

**Replace storage fetch with live state query:**

```javascript
async updateContent() {
  if (!this.panel || !this.isOpen) return;
  
  // OLD: Fetch from storage (slow, stale)
  // const quickTabsState = await this._fetchQuickTabsFromStorage();
  
  // NEW: Query live state (instant, accurate)
  const allQuickTabs = this.liveStateManager.getAll();
  const currentContainerTabs = allQuickTabs.filter(qt => 
    qt.container === this.currentContainerId
  );
  
  // Get minimized count from MinimizedManager
  const minimizedCount = this.minimizedManager.getCount();
  
  // Update statistics with live data
  this._updateStatistics(currentContainerTabs.length, minimizedCount);
  
  // Show/hide empty state
  if (currentContainerTabs.length === 0) {
    this._renderEmptyState();
    return;
  }
  
  // Fetch container info (still needed for display)
  const containerInfo = await this._fetchContainerInfo();
  
  // Render container section with live data
  this._renderContainerSectionFromLiveState(currentContainerTabs, containerInfo);
}
```

**Add new method - _renderContainerSectionFromLiveState():**

```javascript
/**
 * Render container section from live QuickTab entities
 * @param {Array<QuickTab>} quickTabs - Live QuickTab instances
 * @param {Object} containerInfo - Container display info
 * @private
 */
_renderContainerSectionFromLiveState(quickTabs, containerInfo) {
  const containersList = this.panel.querySelector('#panel-containersList');
  const emptyState = this.panel.querySelector('#panel-emptyState');
  
  if (emptyState) {
    emptyState.style.display = 'none';
  }
  
  if (containersList) {
    containersList.style.display = 'block';
    containersList.innerHTML = '';
    
    // Convert QuickTab entities to storage-like format for rendering
    const containerState = {
      tabs: quickTabs.map(qt => ({
        id: qt.id,
        url: qt.url,
        title: qt.title,
        activeTabId: qt.sourceTabId,
        minimized: qt.visibility.minimized,
        width: qt.size.width,
        height: qt.size.height,
        left: qt.position.left,
        top: qt.position.top
      })),
      lastUpdate: Date.now()
    };
    
    const section = PanelUIBuilder.renderContainerSection(
      this.currentContainerId,
      containerInfo,
      containerState
    );
    containersList.appendChild(section);
  }
}
```

**Update _updateStatistics() to show minimized count:**

```javascript
_updateStatistics(totalCount, minimizedCount) {
  const totalTabsEl = this.panel.querySelector('#panel-totalTabs');
  const lastSyncEl = this.panel.querySelector('#panel-lastSync');
  
  if (totalTabsEl) {
    const activeCount = totalCount - minimizedCount;
    totalTabsEl.textContent = `${activeCount} active, ${minimizedCount} minimized`;
  }
  
  if (lastSyncEl) {
    // Show real-time instead of storage timestamp
    const now = new Date();
    lastSyncEl.textContent = `Updated: ${now.toLocaleTimeString()}`;
  }
}
```

### Solution 4: Remove Polling Interval (Optional)

**Where:** `src/features/quick-tabs/panel.js` - `open()`

**Since panel now updates from events, polling is redundant:**

```javascript
open() {
  if (!this.panel) {
    console.error('[PanelManager] Panel not initialized');
    return;
  }
  
  this.panel.style.display = 'flex';
  this.isOpen = true;
  this.stateManager.setIsOpen(true);
  this.panel.style.zIndex = '999999999';
  
  this.contentManager.setIsOpen(true);
  this.contentManager.updateContent();  // Initial update
  
  // REMOVE OR REDUCE polling interval
  // Events will trigger updates, polling is just backup
  if (!this.updateInterval) {
    // Option A: Remove entirely (rely on events only)
    // this.updateInterval = null;
    
    // Option B: Reduce frequency as backup (every 10 seconds instead of 2)
    this.updateInterval = setInterval(() => {
      this.contentManager.updateContent();
    }, 10000);  // Changed from 2000ms to 10000ms
  }
  
  this.stateManager.savePanelState(this.panel);
  this.stateManager.broadcast('PANEL_OPENED', {});
  
  debug('[PanelManager] Panel opened');
}
```

---

## 🎯 Implementation Steps

### Step 1: Update PanelManager to Pass EventBus (30 minutes)

**File:** `src/features/quick-tabs/panel.js`

**In `_initializeControllers()` method:**

1. Add `eventBus`, `liveStateManager`, `minimizedManager` to PanelContentManager dependencies
2. Pass `this.quickTabsManager.internalEventBus`
3. Pass `this.quickTabsManager.state`
4. Pass `this.quickTabsManager.minimizedManager`

**Test:** Check logs show PanelContentManager receives EventBus

### Step 2: Add Event Listeners in PanelContentManager (45 minutes)

**File:** `src/features/quick-tabs/panel/PanelContentManager.js`

**Changes:**

1. Update constructor to accept new dependencies
2. Add `setupStateListeners()` method
3. Call `setupStateListeners()` from `setupEventListeners()`
4. Add console logs to verify listeners fire

**Test:**
- Open panel
- Create Quick Tab → Check panel updates immediately
- Minimize Quick Tab → Check panel updates immediately
- Close Quick Tab → Check panel updates immediately

### Step 3: Replace Storage Query with Live State (1 hour)

**File:** `src/features/quick-tabs/panel/PanelContentManager.js`

**Changes:**

1. Update `updateContent()` to query `liveStateManager.getAll()`
2. Filter by current container
3. Add `_renderContainerSectionFromLiveState()` method
4. Update `_updateStatistics()` to show minimized count
5. Remove or comment out `_fetchQuickTabsFromStorage()`

**Test:**
- Open panel with existing Quick Tabs
- Verify all tabs appear correctly
- Verify minimized tabs show in correct section
- Verify statistics show correct counts

### Step 4: Reduce or Remove Polling Interval (15 minutes)

**File:** `src/features/quick-tabs/panel.js`

**Options:**

**Option A - Remove polling entirely:**
```javascript
// Delete polling code, rely on events only
// Most efficient, but requires events to work perfectly
```

**Option B - Reduce polling frequency as backup:**
```javascript
// Change from 2000ms to 10000ms
// Keeps backup mechanism but reduces overhead
```

**Test:**
- Verify panel still updates when events work
- Verify panel catches up if events fail (with Option B)

### Step 5: Add Defensive Error Handling (30 minutes)

**File:** `src/features/quick-tabs/panel/PanelContentManager.js`

**Add error handling to event listeners:**

```javascript
setupStateListeners() {
  if (!this.eventBus) {
    console.warn('[PanelContentManager] No eventBus available');
    return;
  }
  
  this.eventBus.on('state:added', ({ quickTab }) => {
    try {
      console.log('[PanelContentManager] Quick Tab added:', quickTab.id);
      if (this.isOpen) {
        this.updateContent();
      }
    } catch (err) {
      console.error('[PanelContentManager] Error handling state:added:', err);
    }
  });
  
  // Similar error handling for other events...
}
```

**Add fallback to storage if live state unavailable:**

```javascript
async updateContent() {
  if (!this.panel || !this.isOpen) return;
  
  let quickTabs;
  
  try {
    // Try live state first
    if (this.liveStateManager) {
      quickTabs = this.liveStateManager.getAll();
    } else {
      // Fallback to storage
      const storageState = await this._fetchQuickTabsFromStorage();
      quickTabs = this._extractQuickTabsFromStorage(storageState);
    }
  } catch (err) {
    console.error('[PanelContentManager] Error fetching Quick Tabs:', err);
    return;
  }
  
  // ... rest of method
}
```

---

## 📋 Testing Protocol

### Test 1: Real-Time Panel Updates

**Setup:** Open Quick Tabs Manager Panel

**Actions:**
1. Create new Quick Tab (Ctrl+E on link)
2. **Expected:** Panel shows new tab immediately (< 100ms)
3. **Verify:** Tab count increments, new tab appears in list

**Actions:**
2. Minimize a Quick Tab
3. **Expected:** Tab moves to minimized section immediately
4. **Verify:** "X minimized" count increments, tab shows yellow indicator

**Actions:**
3. Restore minimized Quick Tab
4. **Expected:** Tab returns to active section immediately
5. **Verify:** Minimized count decrements, tab shows green indicator

**Actions:**
4. Close a Quick Tab
5. **Expected:** Tab disappears from panel immediately
6. **Verify:** Tab count decrements, tab removed from list

### Test 2: Cross-Tab Panel Sync

**Setup:** Open panel in Tab A and Tab B

**Actions:**
1. In Tab A, create Quick Tab
2. **Expected:** Panel in Tab B updates automatically
3. **Verify:** Both panels show same tab count and list

**Actions:**
2. In Tab B, minimize Quick Tab
3. **Expected:** Panel in Tab A shows tab as minimized
4. **Verify:** Both panels show same minimized state

### Test 3: Bulk Operations

**Setup:** Panel open with 5 Quick Tabs (3 active, 2 minimized)

**Actions:**
1. Click "Close Minimized" button
2. **Expected:** 2 minimized tabs disappear immediately
3. **Verify:** Tab count updates to show only 3 active tabs

**Actions:**
2. Click "Close All" button
3. **Expected:** All tabs disappear, empty state shown
4. **Verify:** "0 Quick Tabs" displayed, empty state visible

### Test 4: Panel Performance

**Setup:** Create 20 Quick Tabs

**Actions:**
1. Open panel
2. **Expected:** Panel loads instantly with all 20 tabs
3. **Verify:** No lag, smooth scrolling

**Actions:**
2. Rapidly create/close tabs (10 operations in 5 seconds)
3. **Expected:** Panel updates for each operation without lag
4. **Verify:** Counts always accurate, no missed updates

---

## 🎯 Success Criteria

After implementing fixes, verify:

- ✅ Panel updates **immediately** when Quick Tab created (< 100ms delay)
- ✅ Panel updates **immediately** when Quick Tab minimized (< 100ms delay)
- ✅ Panel updates **immediately** when Quick Tab restored (< 100ms delay)
- ✅ Panel updates **immediately** when Quick Tab closed (< 100ms delay)
- ✅ Tab count always shows **accurate** total (active + minimized)
- ✅ Minimized count shows **accurate** number of minimized tabs
- ✅ Active/Minimized sections show tabs in **correct** state
- ✅ Panel syncs across tabs (changes in Tab A appear in Tab B)
- ✅ "Close Minimized" button updates panel immediately
- ✅ "Close All" button clears panel and shows empty state
- ✅ No polling lag (updates instant, not delayed by 2 seconds)
- ✅ Panel performs well with 20+ Quick Tabs

---

## 🔄 Architecture Diagram

### Before (Current - Broken)

```
Quick Tab Created
    ↓
StateManager.add()
    ↓
Emits 'state:added' ────────────→ ❌ Panel not listening
    ↓
Storage updated
    ↓
Panel polls every 2 seconds ──→ Eventually sees change
    ↓
Panel updates (UP TO 2 SECOND DELAY)
```

### After (Fixed - Real-Time)

```
Quick Tab Created
    ↓
StateManager.add()
    ↓
Emits 'state:added' ────────────→ ✅ Panel listening
    ↓                               ↓
Storage updated              PanelContentManager
                                   ↓
                            updateContent() called
                                   ↓
                            Queries live state
                                   ↓
                            Panel updates (< 100ms)
```

---

## 🚨 Why Current Approach Fails

### Problem 1: Asynchronous Storage I/O

**Storage operations are slow:**
- `browser.storage.sync.get()` takes 10-50ms
- Network I/O if sync is involved
- Adds unnecessary latency

**Live state queries are instant:**
- `stateManager.getAll()` takes < 1ms
- In-memory Map lookup
- No I/O overhead

### Problem 2: Polling Waste

**Polling every 2 seconds:**
- 30 storage reads per minute
- Even when nothing changed
- Wastes CPU, memory, battery
- Still has up to 2 second lag

**Event-driven updates:**
- 0 storage reads if no changes
- Update only when actually needed
- Near-instant response time
- Minimal overhead

### Problem 3: Storage Race Conditions

**Storage may not be up-to-date:**
- Quick Tab created → state updated
- Storage save is async (takes time)
- Panel polls before storage write completes
- Panel shows stale data

**Live state is always current:**
- State updated synchronously in-memory
- No async delay
- Always accurate

---

## 📚 Code Changes Summary

### Files to Modify

| File | Changes | Lines | Effort |
|------|---------|-------|--------|
| `src/features/quick-tabs/panel.js` | Pass EventBus to PanelContentManager | ~5 | 15 min |
| `src/features/quick-tabs/panel/PanelContentManager.js` | Add event listeners, query live state | ~100 | 2 hours |
| `src/features/quick-tabs/panel.js` | Reduce/remove polling interval | ~5 | 15 min |

**Total Effort:** ~2.5 hours

### New Methods to Add

**In PanelContentManager.js:**
1. `setupStateListeners()` - Register event listeners
2. `_renderContainerSectionFromLiveState()` - Render from QuickTab entities
3. Error handling in event callbacks

### Methods to Modify

**In PanelContentManager.js:**
1. `constructor()` - Accept new dependencies
2. `updateContent()` - Query live state instead of storage
3. `_updateStatistics()` - Show minimized count, real-time timestamp
4. `setupEventListeners()` - Call `setupStateListeners()`

---

## 🔍 Alternative Solutions (Not Recommended)

### Alternative 1: Increase Polling Frequency

**Approach:** Change interval from 2000ms to 500ms

**Pros:**
- Simple one-line change
- Reduces lag to 500ms

**Cons:**
- Still has lag (500ms delay)
- 4x more storage I/O (120 reads/minute)
- Wastes resources
- Doesn't solve root cause

**Verdict:** ❌ Not recommended - Band-aid solution

### Alternative 2: Manual Panel Refresh Button

**Approach:** Add "Refresh" button to panel

**Pros:**
- No code changes to event system
- User controls when to refresh

**Cons:**
- Poor UX (manual work)
- Still requires polling for auto-refresh
- Doesn't solve stale data problem

**Verdict:** ❌ Not recommended - Terrible UX

### Alternative 3: Hybrid Approach

**Approach:** Keep polling + add event listeners

**Pros:**
- Redundancy (events + polling backup)
- Catches edge cases

**Cons:**
- More complex
- Still some polling overhead
- Events should be reliable enough

**Verdict:** ⚠️ Acceptable - Use if events might fail

---

## 🎯 Recommended Solution

**Implement Solution 1, 2, and 3:**
1. Pass EventBus to PanelContentManager ✅
2. Add event listeners for state changes ✅
3. Query live state instead of storage ✅
4. Keep reduced polling (10s) as backup ⚠️

**This provides:**
- Near-instant updates (< 100ms)
- Minimal resource usage
- Backup mechanism if events fail
- Robust error handling

**Estimated Implementation Time:** 2.5-3 hours

**Expected Improvement:**
- **Before:** Up to 2000ms delay
- **After:** < 100ms delay (20x faster)

---

## 📖 References

- **EventEmitter3 Documentation:** Event bus pattern used by extension
- **StateManager.js:** Emits `state:added`, `state:updated`, `state:deleted` events
- **MinimizedManager.js:** Tracks minimized Quick Tabs
- **Issue #47:** Quick Tabs Intended Behaviors (panel should update in real-time)

---

**Document Version:** 1.0  
**Status:** Ready for Implementation  
**Next Action:** Start with Step 1 (Pass EventBus to PanelContentManager)  
**Expected Outcome:** Panel updates in real-time (< 100ms) when Quick Tabs change state
