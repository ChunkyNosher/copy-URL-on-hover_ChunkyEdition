# Quick Tabs Architecture Conversion Plan

## Complete Implementation Guide for GitHub Copilot

**Status**: Ready for Implementation  
**Duration**: 8 weeks (200-250 hours)  
**Target Version**: v2.0.0  
**Date**: December 13, 2025

---

## Executive Summary

Convert Quick Tabs from fragile **port-based architecture** to robust
**event-driven architecture** using:

- **Storage Layer**: Single `quick_tabs_state_v2` key with `originTabId`
  filtering
- **Messaging Layer**: Replace `runtime.Port` with `tabs.sendMessage()` +
  `runtime.sendMessage()`
- **Sync Layer**: `storage.onChanged` as fallback for eventual consistency

**Fixes Issues**: #3 (race conditions), #5 (port zombies), #8 (corruption), #9
(silent failures)

---

## Architecture Overview

### Current Problems

❌ Uses `runtime.Port` (persistent connections)

- Causes port zombie bugs (duplicate windows)
- Prevents background script from idling (MV3 incompatible)
- Requires keepalive pings every 25s (battery waste)

❌ Multi-key storage (fragmented)

- No deduplication (can't prevent duplicate writes)
- Silent failures (fire-and-forget `set()` calls)
- Corruption undetected

❌ No tab isolation

- Quick Tabs leak across tabs
- EventEmitter3 causes race conditions (no listener ordering)

### New Architecture

✅ **Three Message Patterns**:

- **Pattern A (Local)**: Position/size changes → No broadcast
- **Pattern B (Global)**: Minimize/close → Broadcast to all
- **Pattern C (Manager)**: Close All → Broadcast to all

✅ **Single Storage Key**:

```javascript
{
  "quick_tabs_state_v2": {
    "allQuickTabs": [
      {
        "id": 1,
        "originTabId": 1,  // Tab isolation via filtering
        "url": "...",
        "position": {x, y},
        "size": {w, h},
        "minimized": false
      }
    ],
    "managerState": {...}
  }
}
```

✅ **Fallback Sync**: `storage.onChanged` provides eventual consistency

---

## Phase 1: Foundation (Weeks 1-2)

### 1.1 Create Storage Schema (`src/storage/schema-v2.js`)

**Pure state utility functions** (no side effects):

- `getEmptyState()` - returns clean state
- `getQuickTabsByOriginTabId(state, tabId)` - filter by tab
- `findQuickTabById(state, quickTabId)` - find single QT
- `addQuickTab(state, quickTab)` - add new QT
- `updateQuickTab(state, quickTabId, changes)` - update QT
- `removeQuickTab(state, quickTabId)` - remove QT
- `removeQuickTabsByOriginTabId(state, tabId)` - remove by tab

**Critical**: All functions must use `.map()`, `.filter()`, object spread (no
mutations)

### 1.2 Create Storage Manager (`src/storage/storage-manager.js`)

**Handles all storage operations with validation**:

```javascript
class StorageManager {
  async readState() {
    // Read from browser.storage.local
    // Return empty state if not found
  }

  async writeStateWithValidation(newState, correlationId) {
    // Check deduplication: if same correlationId within 50ms → skip
    // Validate using structuredClone()
    // Write to storage
    // READ BACK for validation (critical for Issue #8)
    // Compare checksums
    // Implement retry with exponential backoff (3x)
    // On failure: call recovery mechanism
  }

  async triggerStorageRecovery() {
    // Attempt backup restore
    // If no backup, reset and notify user
  }
}
```

**Key Features**:

- Deduplication by `correlationId`
- Readback validation on every write
- Retry with exponential backoff (100ms, 200ms, 400ms)
- Telemetry tracking (success rate, retries)

### 1.3 Create Message Router (`src/messaging/message-router.js`)

```javascript
const MESSAGE_TYPES = {
  // Local updates
  QT_POSITION_CHANGED: 'QT_POSITION_CHANGED',
  QT_SIZE_CHANGED: 'QT_SIZE_CHANGED',

  // Global actions
  QT_MINIMIZED: 'QT_MINIMIZED',
  QT_RESTORED: 'QT_RESTORED',
  QT_CLOSED: 'QT_CLOSED',

  // Manager actions
  MANAGER_CLOSE_ALL: 'MANAGER_CLOSE_ALL',
  MANAGER_CLOSE_MINIMIZED: 'MANAGER_CLOSE_MINIMIZED',

  // State sync
  QT_STATE_SYNC: 'QT_STATE_SYNC',
  SIDEBAR_UPDATE: 'SIDEBAR_UPDATE'
};

class MessageBuilder {
  static buildLocalUpdate(type, quickTabId, payload) {
    return { type, quickTabId, ...payload, correlationId: generateId() };
  }

  static buildBroadcastMessage(type, payload) {
    return {
      type,
      ...payload,
      correlationId: generateId(),
      timestamp: Date.now()
    };
  }
}

class MessageValidator {
  static validate(message) {
    if (!MESSAGE_TYPES[message.type]) throw new Error('Unknown type');
    if (!message.correlationId) throw new Error('Missing correlationId');
  }
}
```

---

## Phase 2: Storage Migration (Weeks 2-3)

### 2.1 Create Migration Logic (`background/quick-tabs-initialization.js`)

On extension startup:

1. Check if old keys exist (`qt_positions_tab_1`, etc.)
2. If old + no new key → migrate
3. Convert old structure to new `allQuickTabs[]` format
4. Write using StorageManager
5. Delete old keys (grace period: 5 updates)

### 2.2 Replace ALL Storage Reads

**Search for**: `storage.local.get`, `storage.sync.get`

**Pattern**:

```javascript
// OLD
const result = await browser.storage.local.get('qt_positions_tab_1');

// NEW
const storageManager = new StorageManager('quick_tabs_state_v2');
const state = await storageManager.readState();
const myTabId = (await browser.tabs.getCurrent()).id;
const myQuickTabs = SchemaV2.getQuickTabsByOriginTabId(state, myTabId);
```

### 2.3 Replace ALL Storage Writes

**Search for**: `storage.local.set`, `storage.sync.set`

**Pattern**:

```javascript
// OLD
browser.storage.local.set({'qt_positions_' + tabId: {x, y}});

// NEW
const state = await storageManager.readState();
const updated = SchemaV2.updateQuickTab(state, quickTabId, {
  position: {x, y}
});
const correlationId = `${tabId}-${Date.now()}`;
await storageManager.writeStateWithValidation(updated, correlationId);
```

---

## Phase 3: Messaging Conversion (Weeks 3-5)

### 3.1 Replace Content Script Communication

**Search for**: `runtime.connect`, `port.postMessage`, `port.onMessage`

**Remove ALL**:

- `let port = browser.runtime.connect()`
- `port.onDisconnect.addListener()`
- `portRegistry` management

**Add**:

```javascript
// Listen for state updates FROM background
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) return;

  if (message.type === MESSAGE_TYPES.QT_STATE_SYNC) {
    const myTabId = (await browser.tabs.getCurrent()).id;
    const myQTs = message.state.allQuickTabs.filter(
      qt => qt.originTabId === myTabId
    );
    uiCoordinator.syncState(myQTs);
    return {success: true};
  }
});

// Send updates TO background (Pattern A: local-only)
async function notifyPositionChanged(quickTabId, newPosition) {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.QT_POSITION_CHANGED,
      quickTabId,
      newPosition,
      correlationId: generateId()
    }, {signal: controller.signal});
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('Position update timed out');
    } else {
      console.error('Failed to send position update:', err);
    }
    // Fallback: storage.onChanged will sync eventually
  }
}

// Send global actions (Pattern B: broadcast)
async function notifyMinimized(quickTabId) {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.QT_MINIMIZED,
      quickTabId,
      correlationId: generateId()
    });
  } catch (err) {
    console.error('Failed to send minimize action:', err);
  }
}
```

### 3.2 Add Storage Fallback Listener

```javascript
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes.quick_tabs_state_v2) return;

  const newState = changes.quick_tabs_state_v2.newValue;
  const myTabId = (await browser.tabs.getCurrent()).id;
  const myQTs = newState.allQuickTabs.filter(qt => qt.originTabId === myTabId);

  uiCoordinator.syncStateFromStorage(myQTs);
});
```

### 3.3 Create Background Message Handler

**File**: `background/message-handler.js`

```javascript
const messageHandlers = {
  [MESSAGE_TYPES.QT_POSITION_CHANGED]: handlePositionChanged,
  [MESSAGE_TYPES.QT_MINIMIZED]: handleMinimize,
  [MESSAGE_TYPES.QT_RESTORED]: handleRestore,
  [MESSAGE_TYPES.QT_CLOSED]: handleClose,
  [MESSAGE_TYPES.MANAGER_CLOSE_ALL]: handleCloseAll,
  [MESSAGE_TYPES.MANAGER_CLOSE_MINIMIZED]: handleCloseMinimized
};

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!message.type || !message.correlationId) {
    return { success: false, error: 'Missing fields' };
  }

  const handler = messageHandlers[message.type];
  if (!handler) {
    return { success: false, error: 'Unknown type' };
  }

  try {
    const result = await handler(message, sender);
    return { success: true, ...result };
  } catch (err) {
    console.error('Handler error:', err);
    return { success: false, error: err.message };
  }
});

// Pattern A: Local update (no broadcast)
async function handlePositionChanged(message, sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, message.quickTabId, {
    position: message.newPosition
  });
  await storageManager.writeStateWithValidation(updated, message.correlationId);
  return { updated: true };
}

// Pattern B: Global action (broadcast)
async function handleMinimize(message, sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, message.quickTabId, {
    minimized: true
  });
  await storageManager.writeStateWithValidation(updated, message.correlationId);

  // Broadcast to all tabs
  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { minimized: true };
}

// Broadcast helper
async function broadcastStateToAllTabs(state) {
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    if (!tab.url?.startsWith('http')) continue;

    try {
      await browser.tabs
        .sendMessage(tab.id, {
          type: MESSAGE_TYPES.QT_STATE_SYNC,
          state: state,
          timestamp: Date.now()
        })
        .catch(() => {});
    } catch (err) {
      // Tab not ready - OK, storage.onChanged will sync
    }
  }
}
```

---

## Phase 4: UICoordinator Refactoring (Weeks 5-6)

### 4.1 Implement Hydration with Tab Filtering

```javascript
async function hydrate() {
  const storageManager = new StorageManager('quick_tabs_state_v2');
  const state = await storageManager.readState();

  const currentTab = await browser.tabs.getCurrent();
  const tabId = currentTab.id;

  // CRITICAL: Filter by originTabId
  const myQuickTabs = SchemaV2.getQuickTabsByOriginTabId(state, tabId);

  myQuickTabs.forEach(qt => {
    quickTabRegistry.set(qt.id, qt);
    uiCoordinator.render(qt);
  });

  console.log(
    `[Hydration] Restored ${myQuickTabs.length} QTs for tab ${tabId}`
  );
}
```

### 4.2 Implement Event Listeners

```javascript
// Listen for drag/resize
quickTabElement.addEventListener('dragend', async e => {
  const newPosition = { x: e.clientX, y: e.clientY };
  const correlationId = generateId();

  // Send to background
  await notifyPositionChanged(quickTabId, newPosition);

  // Emergency save to storage
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, quickTabId, {
    position: newPosition
  });
  await storageManager.writeStateWithValidation(updated, correlationId);
});

// Minimize button
minimizeButton.addEventListener('click', async () => {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.QT_MINIMIZED,
      quickTabId,
      correlationId: generateId()
    });
  } catch (err) {
    console.error('Minimize failed:', err);
    uiCoordinator.removeFromDOM(quickTabId);
  }
});
```

---

## Phase 5: Manager Refactoring (Week 6)

### 5.1 Manager State and Grouping

```javascript
async function loadManagerState() {
  const storageManager = new StorageManager('quick_tabs_state_v2');
  const state = await storageManager.readState();

  // Group by originTabId
  const grouped = new Map();
  for (const qt of state.allQuickTabs) {
    if (!grouped.has(qt.originTabId)) {
      grouped.set(qt.originTabId, []);
    }
    grouped.get(qt.originTabId).push(qt);
  }

  renderManagerSections(grouped);
}

async function renderManagerSections(groupedByOrigin) {
  const container = document.getElementById('manager-container');
  container.innerHTML = '';

  if (groupedByOrigin.size === 0) {
    container.innerHTML = '<p>No Quick Tabs</p>';
    return;
  }

  for (const [originTabId, qts] of groupedByOrigin) {
    const tab = await browser.tabs.get(originTabId);
    const section = createOriginSection(tab, qts);
    container.appendChild(section);
  }
}

function createOriginSection(tab, qts) {
  const section = document.createElement('div');
  section.className = 'manager-section';

  const header = document.createElement('h3');
  header.textContent = `${new URL(tab.url).hostname} (${qts.length})`;
  section.appendChild(header);

  const list = document.createElement('ul');
  for (const qt of qts) {
    const item = document.createElement('li');
    item.className = qt.minimized ? 'minimized' : 'active';

    const label = document.createElement('span');
    label.textContent = qt.url.substring(0, 50) + '...';
    item.appendChild(label);

    const buttons = document.createElement('div');
    if (qt.minimized) {
      const btn = document.createElement('button');
      btn.textContent = 'Restore';
      btn.onclick = () => restoreQuickTab(qt.id, qt.originTabId);
      buttons.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.textContent = 'Minimize';
      btn.onclick = () => minimizeQuickTab(qt.id, qt.originTabId);
      buttons.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => closeQuickTab(qt.id, qt.originTabId);
    buttons.appendChild(closeBtn);

    item.appendChild(buttons);
    list.appendChild(item);
  }
  section.appendChild(list);

  return section;
}
```

### 5.2 Manager Actions

```javascript
async function minimizeQuickTab(quickTabId, originTabId) {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.QT_MINIMIZED,
      quickTabId,
      originTabId,
      correlationId: generateId()
    });
  } catch (err) {
    console.error('Failed to minimize:', err);
  }
}

async function closeAllQuickTabs() {
  if (!confirm('Close all Quick Tabs?')) return;

  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.MANAGER_CLOSE_ALL,
      correlationId: generateId()
    });
  } catch (err) {
    console.error('Failed to close all:', err);
  }
}

async function closeMinimizedQuickTabs() {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.MANAGER_CLOSE_MINIMIZED,
      correlationId: generateId()
    });
  } catch (err) {
    console.error('Failed to close minimized:', err);
  }
}

// Listen for storage changes and refresh
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.quick_tabs_state_v2) {
    const newState = changes.quick_tabs_state_v2.newValue;
    loadManagerState(); // Refresh UI
  }
});
```

---

## Phase 6: Background Handlers (Weeks 6-7)

### 6.1 Pattern A Handlers (Local Updates)

```javascript
async function handleSizeChanged(message, sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, message.quickTabId, {
    size: message.newSize
  });
  await storageManager.writeStateWithValidation(updated, message.correlationId);
  return { updated: true };
}
```

### 6.2 Pattern B Handlers (Global Actions)

```javascript
async function handleRestore(message, sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, message.quickTabId, {
    minimized: false
  });
  await storageManager.writeStateWithValidation(updated, message.correlationId);

  // Broadcast
  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { restored: true };
}

async function handleClose(message, sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.removeQuickTab(state, message.quickTabId);
  await storageManager.writeStateWithValidation(updated, message.correlationId);

  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { closed: true };
}
```

### 6.3 Pattern C Handlers (Manager Actions)

```javascript
async function handleCloseAll(message, sender) {
  const state = await storageManager.readState();
  const updated = {
    ...state,
    allQuickTabs: []
  };
  await storageManager.writeStateWithValidation(updated, message.correlationId);

  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { closedCount: state.allQuickTabs.length };
}

async function handleCloseMinimized(message, sender) {
  const state = await storageManager.readState();
  let updated = state;

  const minimizedIds = state.allQuickTabs
    .filter(qt => qt.minimized)
    .map(qt => qt.id);

  for (const id of minimizedIds) {
    updated = SchemaV2.removeQuickTab(updated, id);
  }

  await storageManager.writeStateWithValidation(updated, message.correlationId);

  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { closedCount: minimizedIds.length };
}
```

---

## Phase 7: Testing (Weeks 7-8)

### Key Scenarios from Issue 47

| Scenario | Test                                            |
| -------- | ----------------------------------------------- |
| 1        | QT in WP 1 NOT visible in YT 1 ✓                |
| 3        | Drag QT, reload, position restored ✓            |
| 4        | Manager groups by origin tab ✓                  |
| 5        | Minimize hides QT, shows in Manager ✓           |
| 7        | Close All removes all QTs ✓                     |
| 8        | Close Minimized removes only minimized ✓        |
| 10       | Browser restart restores state ✓                |
| 11       | Page reload hydrates origin tab only ✓          |
| 12       | Closing tab removes its QTs from Manager ✓      |
| 13       | Position change in tab A doesn't affect tab B ✓ |
| 17       | Rapid tab switch saves position ✓               |
| 18       | Container isolation respected ✓                 |
| 20       | Cross-domain nav preserves QTs ✓                |

### Performance Targets

- Storage write: <100ms
- Hydration: <500ms
- Broadcast: <200ms
- Storage size: <1MB for 100+ QTs
- Memory: <50MB (no leaks)

---

## Phase 8: Monitoring (Ongoing)

### Feature Flags

```javascript
const FEATURE_FLAGS = {
  USE_NEW_STORAGE_SCHEMA: true,
  USE_TABS_SENDMESSAGE: true,
  USE_ORIGINTTABID_FILTERING: true
};

// Can be toggled via: browser.storage.local.set({feature_flags: {USE_NEW_STORAGE_SCHEMA: false}})
```

### Telemetry

Track:

- Storage write success rate
- Port zombie occurrences (should be 0)
- Hydration time
- Broadcast latency
- Corruption detections (should be 0)

---

## Common Pitfalls to Avoid

❌ **Reading full state in content script without filtering**

```javascript
// WRONG - renders QTs from other tabs!
const state = await storageManager.readState();
uiCoordinator.renderAll(state.allQuickTabs);

// RIGHT - filter by originTabId
const myQTs = SchemaV2.getQuickTabsByOriginTabId(state, tabId);
uiCoordinator.renderAll(myQTs);
```

❌ **Mutating state directly**

```javascript
// WRONG
state.allQuickTabs.push(newQT);

// RIGHT
const updated = SchemaV2.addQuickTab(state, newQT);
```

❌ **Broadcasting on every update**

```javascript
// WRONG - broadcasts position to 50+ tabs
async function handlePositionChanged(message) {
  const updated = SchemaV2.updateQuickTab(state, ...);
  await broadcastStateToAllTabs(updated); // NO!
}

// RIGHT - only broadcast global actions
async function handlePositionChanged(message) {
  const updated = SchemaV2.updateQuickTab(state, ...);
  // No broadcast
}
```

❌ **Forgetting correlationId**

```javascript
// WRONG
await browser.runtime.sendMessage({
  type: MESSAGE_TYPES.QT_MINIMIZED,
  quickTabId
});

// RIGHT
await browser.runtime.sendMessage({
  type: MESSAGE_TYPES.QT_MINIMIZED,
  quickTabId,
  correlationId: generateId()
});
```

❌ **Not handling message errors**

```javascript
// WRONG
await browser.tabs.sendMessage(tab.id, message);

// RIGHT
try {
  await browser.tabs.sendMessage(tab.id, message).catch(() => {}); // Suppress error for non-ready tabs
} catch (err) {
  // Suppress
}
```

---

## Success Criteria

### Functional

✅ Issue 47 scenarios pass (21 test cases) ✅ No cross-tab data leakage ✅
Manager shows correct grouping ✅ Position/size persist across reload

### Reliability

✅ No port zombie windows (Issue #5 fixed) ✅ No silent storage failures (Issues
#8, #9 fixed) ✅ All messages have error handling ✅ Storage corruption detected
and recovered

### Performance

✅ Storage writes <100ms ✅ Hydration <500ms ✅ Broadcasts <200ms ✅ Memory
<50MB

---

## Quick Reference: Search & Replace

Search for old code:

- `browser.runtime.connect` → REMOVE
- `runtime.Port` → REMOVE
- `port.postMessage` → Replace with `runtime.sendMessage()`
- `port.onMessage` → Replace with `runtime.onMessage`
- `storage.local.get('qt_` → Replace with StorageManager
- `storage.local.set({qt_` → Replace with StorageManager

---

## Timeline

**Week 1-2**: Phase 1 (Storage schema + manager + router) **Week 2-3**: Phase 2
(Storage migration) **Week 3-5**: Phase 3 (Messaging conversion) **Week 5-6**:
Phase 4 (UICoordinator) **Week 6**: Phase 5 (Manager) **Week 6-7**: Phase 6
(Background handlers) **Week 7-8**: Phase 7 (Testing) **Week 8+**: Phase 8
(Monitoring)

---

## Files to Create (~15)

- `src/storage/schema-v2.js`
- `src/storage/storage-manager.js`
- `src/messaging/message-router.js`
- `background/quick-tabs-initialization.js`
- `background/message-handler.js`
- `background/broadcast-manager.js`
- `src/features/quick-tabs/quick-tab-registry.js`
- `src/features/sidebar/manager-renderer.js`
- `src/features/sidebar/manager-grouping.js`
- `src/features/sidebar/manager-actions.js`
- `src/test-bridge.js`
- `src/telemetry.js`
- `src/feature-flags.js`
- (+ more utility files)

## Files to Modify (~8)

- `background/quick-tabs-manager.js`
- `background/quick-tabs-handler.js`
- `src/features/quick-tabs/index.js`
- `src/features/sidebar/index.js`
- Any file with `storage.local` calls
- Any file with `runtime.Port` usage

---

**Status**: ✅ READY FOR IMPLEMENTATION  
**Confidence Level**: HIGH  
**Next Step**: Begin Phase 1 with StorageManager creation
